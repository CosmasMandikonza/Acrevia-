import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolutionEnvelope } from "../../../../adapters/gis/resolution-envelope";
import type { CommitReceipt } from "../../../../adapters/gis/commit-receipt";
import {
  BaseProjectDriftError,
  MissionCommandLog,
  rebuildAcceptedProject,
  replayMissionCommands,
  sha256Project,
  verifyAcceptedPair,
} from "../../../../application/mission/rebuild";
import { compileRegulations } from "../../../../application/regulatory/compile";
import type { CandidateRule } from "../../../../application/regulatory/candidate-rule";
import { ProjectCodec } from "../../../../adapters/persistence/project-codec";
import { loadBenchmarkEvidence } from "../../../../adapters/regulatory/benchmark-evidence";
import { benchmarkExtractionAdapter } from "../../../../adapters/regulatory/benchmark-extractor";
import { seedSolverAssumptions } from "../../../../application/solver/assumptions";
import { solve } from "../../../../application/solver/solve";
import { recordSolverScenarios } from "../../../../application/solver/record";
import { SolveRefusal } from "../../../../application/solver/inputs";
import {
  buildProofSnapshot,
  CANONICAL_BENCHMARK_PARCEL_KEY,
  OpenQuestionDoc,
  seedBenchmarkOpenQuestionsForProperty,
} from "../../../../application/proof/snapshot";
import type { CommandContext } from "../../../../commands";

/**
 * POST /api/proof/snapshot — the trusted Proof projection endpoint (issue #11).
 *
 * Proof is a VIEW over existing truth, never a parallel store. The route
 * rebuilds exactly what the solver route rebuilds — verify the accepted
 * { envelope, receipt } pair, hash-gate the committed base project, compile
 * current law (fail-closed property binding), replay the mission command log,
 * seed assumptions, solve, and record current scenarios/certificates — then
 * projects the graph into a read-only typed snapshot for the Evidence
 * surface. Nothing is persisted server-side; client-supplied graph data is
 * never read (only optional real graph ids to focus/validate).
 *
 * The canonical benchmark's open questions seed as REAL ExpertReview nodes
 * through the typed command boundary (same deterministic ids as the legacy
 * seed) — but ONLY when the accepted property IS the canonical benchmark
 * property (exact confirmed-parcel identity, never district-level matching).
 * Another RM-1 property gets an honest empty expert-review state and keeps
 * its own unresolved computation questions; Calvary's title/history/FAR
 * questions never attach to another church.
 */

export const dynamic = "force-dynamic";

const FIXTURE_DIR = "docs/benchmarks/calvary-memorial-philadelphia";
const SUPPORTED_DISTRICTS = new Set(["RM-1"]);
const LAW_SOURCES = new Set(["S5", "S6", "S7"]);

function canonicalDistrict(raw: string | undefined): string | null {
  if (!raw) return null;
  const normalized = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (normalized === "RM1") return "RM-1";
  return raw.trim().toUpperCase();
}

export async function POST(request: Request) {
  let body: {
    envelope?: ResolutionEnvelope;
    receipt?: CommitReceipt;
    commands?: unknown;
    scenarioId?: unknown;
    certificateId?: unknown;
    focusNodeId?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.envelope || !body.receipt || !Array.isArray(body.commands)) {
    return NextResponse.json(
      {
        error:
          "proof snapshot requires the accepted { envelope, receipt } pair and a mission command log (possibly empty)",
      },
      { status: 400 },
    );
  }
  let commands: ReturnType<typeof MissionCommandLog.parse>;
  try {
    commands = MissionCommandLog.parse(body.commands);
  } catch (cause) {
    return NextResponse.json(
      {
        error: cause instanceof Error ? cause.message : "malformed mission command log",
        name: "InvalidMissionCommandLog",
      },
      { status: 400 },
    );
  }
  const optionalId = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;

  try {
    const { session, receiptPayload } = verifyAcceptedPair(body.envelope, body.receipt);
    const project = rebuildAcceptedProject(session, receiptPayload);
    const baseHash = sha256Project(ProjectCodec.encode(project));
    if (baseHash !== receiptPayload.projectHash) {
      throw new BaseProjectDriftError(
        "the accepted property's committed project could not be reproduced exactly; re-resolve and re-accept the property",
      );
    }
    if (session.confirmedParcelIds.length > 1 || session.parcelContexts.length > 1) {
      return NextResponse.json({
        status: "multi-parcel-unsupported",
        reason:
          "This accepted property has multiple confirmed parcels; per-parcel solving is required before a proof snapshot can be computed for it.",
      });
    }

    const context = session.parcelContexts[0];
    const rawDistrict = context?.zoningBase?.districtLong ?? context?.zoningBase?.district;
    const district = canonicalDistrict(rawDistrict);
    const parcelKey = session.confirmedParcelIds[0];
    const subjectNodeId = `gis:parcel:${parcelKey}`;
    const zoningBaseClaim = project.nodes[`gis:claim:zoning-base:${parcelKey}`];
    const overlayClaim = project.nodes[`gis:claim:zoning-overlays:${parcelKey}`];
    if (!district || !zoningBaseClaim || zoningBaseClaim.kind !== "claim") {
      return NextResponse.json({
        status: "needs-evidence",
        reason:
          "The accepted property has no verified base zoning district claim in its signed session, so no proof can be projected for it yet. Re-resolve the property.",
      });
    }
    if (!SUPPORTED_DISTRICTS.has(district)) {
      return NextResponse.json({
        status: "unsupported-district",
        district,
        reason:
          `The captured legal corpus covers ${[...SUPPORTED_DISTRICTS].join(", ")}; ` +
          `this accepted property is zoned ${district}. Acrevia will not apply another district's law to it.`,
      });
    }

    const overlayNames = (context?.zoningOverlays?.overlays ?? []).map((o) => o.name ?? "");
    const sixProven =
      overlayNames.some((name) => /sixth district overlay/i.test(name)) &&
      overlayClaim?.kind === "claim";

    // Law enters exactly the way /api/regulatory/compile enters it.
    const evidence = loadBenchmarkEvidence({
      fixtureDir: FIXTURE_DIR,
      subject: { subjectNodeId, jurisdictionKey: "philadelphia-pa", district },
    });
    const extraction = await benchmarkExtractionAdapter.extract(evidence);
    const lawCandidates: CandidateRule[] = extraction.candidates.filter((candidate) => {
      if (!LAW_SOURCES.has(candidate.sourceRef)) return false;
      if (candidate.sourceRef === "S6" && !sixProven) return false;
      return true;
    });
    const ctx: CommandContext = { project, actor: "proof-projection" };
    const compile = compileRegulations(ctx, {
      candidates: lawCandidates,
      sources: evidence.sources,
      subject: { district, parcelNodeId: subjectNodeId, jurisdictionKey: "philadelphia-pa" },
      documents: evidence.documents,
      applicabilityClaims: {
        zoningBaseClaimId: `gis:claim:zoning-base:${parcelKey}`,
        overlayClaimIds: overlayClaim?.kind === "claim" ? [`gis:claim:zoning-overlays:${parcelKey}`] : [],
      },
    });

    replayMissionCommands(project, commands, {
      actor: "church-leader",
      fallbackAt: receiptPayload.committedAt,
    });
    seedSolverAssumptions(ctx);

    // Real ExpertReview nodes for the benchmark's open questions — ONLY for
    // the canonical benchmark property (exact confirmed-parcel identity).
    // The questions are Calvary-specific validation context; another RM-1
    // property keeps its own unresolved computation questions and an honest
    // empty expert-review state instead.
    if (parcelKey === CANONICAL_BENCHMARK_PARCEL_KEY) {
      const openQuestions = OpenQuestionDoc.parse(
        JSON.parse(readFileSync(join(FIXTURE_DIR, "open-questions.json"), "utf-8")),
      );
      seedBenchmarkOpenQuestionsForProperty(ctx, openQuestions, parcelKey);
    }

    const result = solve(project);
    if (result.status !== "SOLVED") {
      return NextResponse.json({
        status: "needs-evidence",
        reason:
          "The deterministic solver could not compute a current scenario for this property's state, so there is no proof to project yet.",
      });
    }
    const recorded = recordSolverScenarios(ctx, result);

    const snapshot = buildProofSnapshot(project, {
      solve: result,
      recorded,
      conflicts: compile.conflicts,
      identity: {
        query: session.query,
        matchedAddress: session.selectedAddress?.matchedAddress,
        district,
        overlay: overlayNames[0],
        parcelNodeId: subjectNodeId,
      },
      requestedScenarioId: optionalId(body.scenarioId),
      requestedCertificateId: optionalId(body.certificateId),
      focusNodeId: optionalId(body.focusNodeId),
    });
    return NextResponse.json(snapshot);
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    if (error instanceof SolveRefusal || name === "SolveRefusal") {
      const refusal = error as SolveRefusal;
      return NextResponse.json({ status: "REFUSED", reason: refusal.reason, message: refusal.message });
    }
    if (name === "BaseProjectDriftError") {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "base project drift", name, reacceptRequired: true },
        { status: 409 },
      );
    }
    if (name === "PairVerificationError" || name === "CommandReplayError" || name === "InvalidMissionCommandLog") {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "verification failed", name },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "proof snapshot failed", name },
      { status: 400 },
    );
  }
}
