import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolutionEnvelope } from "../../adapters/gis/resolution-envelope";
import type { CommitReceipt } from "../../adapters/gis/commit-receipt";
import {
  BaseProjectDriftError,
  MissionCommandLog,
  rebuildAcceptedProject,
  replayMissionCommands,
  sha256Project,
  verifyAcceptedPair,
} from "../mission/rebuild";
import { compileRegulations } from "../regulatory/compile";
import type { CandidateRule } from "../regulatory/candidate-rule";
import { ProjectCodec } from "../../adapters/persistence/project-codec";
import { loadBenchmarkEvidence } from "../../adapters/regulatory/benchmark-evidence";
import { benchmarkExtractionAdapter } from "../../adapters/regulatory/benchmark-extractor";
import { seedSolverAssumptions } from "../solver/assumptions";
import { solve, type SolveSuccess } from "../solver/solve";
import { recordSolverScenarios, type RecordedScenario } from "../solver/record";
import type { ConflictRecord } from "../regulatory/conflicts";
import type { CommandContext } from "../../commands";
import type { Project } from "../../domain/graph/project";
import type { ResolutionSession } from "../resolution/state";
import {
  buildProofSnapshot,
  CANONICAL_BENCHMARK_PARCEL_KEY,
  OpenQuestionDoc,
  seedBenchmarkOpenQuestionsForProperty,
  type ProofSnapshot,
} from "./snapshot";

/**
 * Shared trusted-state pipeline (issues #11 + #10).
 *
 * Both POST /api/proof/snapshot and the Copilot (#10) need the exact same
 * server-side truth rebuild: verify the accepted { envelope, receipt } pair,
 * hash-gate the committed base project, apply the property gates, compile
 * current law (fail-closed property binding), replay the mission command log,
 * seed assumptions (plus the canonical benchmark's expert-review items), solve
 * deterministically, and record scenarios/certificates. This module is that
 * ONE pipeline; the routes only map the result to their response shapes.
 *
 * Nothing is persisted; nothing client-supplied beyond the signed pair, the
 * typed mission command log, and optional real graph ids is ever read.
 */

const FIXTURE_DIR = "docs/benchmarks/calvary-memorial-philadelphia";
const SUPPORTED_DISTRICTS = new Set(["RM-1"]);
const LAW_SOURCES = new Set(["S5", "S6", "S7"]);

function canonicalDistrict(raw: string | undefined): string | null {
  if (!raw) return null;
  const normalized = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (normalized === "RM1") return "RM-1";
  return raw.trim().toUpperCase();
}

export type TrustedSnapshotFocus = {
  scenarioId?: string;
  certificateId?: string;
  focusNodeId?: string;
};

export type TrustedProofContext =
  | { status: "multi-parcel-unsupported" }
  | { status: "needs-evidence"; reason: string }
  | { status: "unsupported-district"; district: string; reason: string }
  | {
      status: "ready";
      session: ResolutionSession;
      project: Project;
      parcelKey: string;
      subjectNodeId: string;
      district: string;
      overlayNames: string[];
      compile: { conflicts: ConflictRecord[] };
      solve: SolveSuccess;
      recorded: RecordedScenario[];
      snapshot: ProofSnapshot;
    };

/**
 * Rebuild the trusted project state for an accepted property. Throws
 * PairVerificationError / BaseProjectDriftError / CommandReplayError /
 * MissingSecretError / SolveRefusal exactly like the previous inline route
 * pipeline did — routes keep their fail-closed error mapping.
 */
export async function buildTrustedProofContext(
  envelope: ResolutionEnvelope,
  receipt: CommitReceipt,
  commands: MissionCommandLog,
  focus: TrustedSnapshotFocus = {},
): Promise<TrustedProofContext> {
  const { session, receiptPayload } = verifyAcceptedPair(envelope, receipt);
  const project = rebuildAcceptedProject(session, receiptPayload);
  const baseHash = sha256Project(ProjectCodec.encode(project));
  if (baseHash !== receiptPayload.projectHash) {
    throw new BaseProjectDriftError(
      "the accepted property's committed project could not be reproduced exactly; re-resolve and re-accept the property",
    );
  }
  if (
    session.confirmedParcelIds.length > 1 ||
    session.parcelContexts.length > 1
  ) {
    return { status: "multi-parcel-unsupported" };
  }

  const context = session.parcelContexts[0];
  const rawDistrict =
    context?.zoningBase?.districtLong ?? context?.zoningBase?.district;
  const district = canonicalDistrict(rawDistrict);
  const parcelKey = session.confirmedParcelIds[0];
  const subjectNodeId = `gis:parcel:${parcelKey}`;
  const zoningBaseClaim = project.nodes[`gis:claim:zoning-base:${parcelKey}`];
  const overlayClaim = project.nodes[`gis:claim:zoning-overlays:${parcelKey}`];
  if (!district || !zoningBaseClaim || zoningBaseClaim.kind !== "claim") {
    return {
      status: "needs-evidence",
      reason:
        "The accepted property has no verified base zoning district claim in its signed session, so no proof can be projected for it yet. Re-resolve the property.",
    };
  }
  if (!SUPPORTED_DISTRICTS.has(district)) {
    return {
      status: "unsupported-district",
      district,
      reason:
        `The captured legal corpus covers ${[...SUPPORTED_DISTRICTS].join(", ")}; ` +
        `this accepted property is zoned ${district}. Acrevia will not apply another district's law to it.`,
    };
  }

  const overlayNames = (context?.zoningOverlays?.overlays ?? []).map(
    (o) => o.name ?? "",
  );
  const sixProven =
    overlayNames.some((name) => /sixth district overlay/i.test(name)) &&
    overlayClaim?.kind === "claim";

  // Law enters exactly the way /api/regulatory/compile enters it.
  const evidence = loadBenchmarkEvidence({
    fixtureDir: FIXTURE_DIR,
    subject: { subjectNodeId, jurisdictionKey: "philadelphia-pa", district },
  });
  const extraction = await benchmarkExtractionAdapter.extract(evidence);
  const lawCandidates: CandidateRule[] = extraction.candidates.filter(
    (candidate) => {
      if (!LAW_SOURCES.has(candidate.sourceRef)) return false;
      if (candidate.sourceRef === "S6" && !sixProven) return false;
      return true;
    },
  );
  const ctx: CommandContext = { project, actor: "proof-projection" };
  const compile = compileRegulations(ctx, {
    candidates: lawCandidates,
    sources: evidence.sources,
    subject: {
      district,
      parcelNodeId: subjectNodeId,
      jurisdictionKey: "philadelphia-pa",
    },
    documents: evidence.documents,
    applicabilityClaims: {
      zoningBaseClaimId: `gis:claim:zoning-base:${parcelKey}`,
      overlayClaimIds:
        overlayClaim?.kind === "claim"
          ? [`gis:claim:zoning-overlays:${parcelKey}`]
          : [],
    },
  });

  replayMissionCommands(project, commands, {
    actor: "church-leader",
    fallbackAt: receiptPayload.committedAt,
  });
  seedSolverAssumptions(ctx);

  // Real ExpertReview nodes for the benchmark's open questions — ONLY for
  // the canonical benchmark property (exact confirmed-parcel identity).
  if (parcelKey === CANONICAL_BENCHMARK_PARCEL_KEY) {
    const openQuestions = OpenQuestionDoc.parse(
      JSON.parse(
        readFileSync(join(FIXTURE_DIR, "open-questions.json"), "utf-8"),
      ),
    );
    seedBenchmarkOpenQuestionsForProperty(ctx, openQuestions, parcelKey);
  }

  const result = solve(project);
  if (result.status !== "SOLVED") {
    return {
      status: "needs-evidence",
      reason:
        "The deterministic solver could not compute a current scenario for this property's state, so there is no proof to project yet.",
    };
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
    requestedScenarioId: focus.scenarioId,
    requestedCertificateId: focus.certificateId,
    focusNodeId: focus.focusNodeId,
  });
  return {
    status: "ready",
    session,
    project,
    parcelKey,
    subjectNodeId,
    district,
    overlayNames,
    compile: { conflicts: compile.conflicts },
    solve: result,
    recorded,
    snapshot,
  };
}
