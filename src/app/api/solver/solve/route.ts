import { NextResponse } from "next/server";
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
import { SolveRefusal } from "../../../../application/solver/inputs";
import { buildGeometryHandoff } from "../../../../application/solver/geometry-handoff";
import type { CommandContext } from "../../../../commands";

/**
 * POST /api/solver/solve — the Deterministic Scenario Solver (issue #7).
 *
 * LAW says what may happen. MISSION says what the church refuses to
 * sacrifice. The SOLVER computes the intersection — and only the
 * intersection. It consumes executable law EXCLUSIVELY through
 * selectExecutableConstraints() inside solve(), never the raw compiled view;
 * missions arrive only through the typed CONFIRMED command log; every number
 * it returns is either computed from the accepted geometry, quoted from a
 * verified law decision, or labeled as an assumption. There is no third
 * channel. When no verified solution exists it says so and proves WHICH
 * binding constraints close the door.
 *
 * Statelessness and trust are identical to /api/mission/state: the accepted
 * { envelope, receipt } pair is verified, the committed base project is
 * rebuilt and hash-gated, and the mission command log replays through the
 * command boundary before any solving. Nothing is persisted.
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
    targetHomes?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.envelope || !body.receipt || !Array.isArray(body.commands)) {
    return NextResponse.json(
      { error: "solver requires the accepted { envelope, receipt } pair and a mission command log (possibly empty)" },
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
  let targetHomes: number | undefined;
  if (body.targetHomes !== undefined && body.targetHomes !== null) {
    if (typeof body.targetHomes !== "number" || !Number.isInteger(body.targetHomes) || body.targetHomes < 0) {
      return NextResponse.json(
        { error: "targetHomes must be a non-negative whole number of homes" },
        { status: 400 },
      );
    }
    targetHomes = body.targetHomes;
  }

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
          "This accepted property has multiple confirmed parcels; per-parcel solving is required before any scenario can be computed for it.",
      });
    }

    const context = session.parcelContexts[0];
    const rawDistrict = context?.zoningBase?.districtLong ?? context?.zoningBase?.district;
    const district = canonicalDistrict(rawDistrict);
    const subjectNodeId = `gis:parcel:${session.confirmedParcelIds[0]}`;
    const parcelKey = session.confirmedParcelIds[0];
    const zoningBaseClaim = project.nodes[`gis:claim:zoning-base:${parcelKey}`];
    const overlayClaim = project.nodes[`gis:claim:zoning-overlays:${parcelKey}`];
    if (!district || !zoningBaseClaim || zoningBaseClaim.kind !== "claim") {
      return NextResponse.json({
        status: "needs-evidence",
        reason:
          "The accepted property has no verified base zoning district claim in its signed session, so no law can be executed for it yet. Re-resolve the property.",
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

    // Law enters the project exactly the way /api/regulatory/compile enters
    // it; the solver then reads ONLY the executable gate inside solve().
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
    const ctx: CommandContext = { project, actor: "scenario-solver" };
    compileRegulations(ctx, {
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

    const result = solve(project, targetHomes === undefined ? {} : { targetHomes });

    if (result.status === "SOLVED") {
      return NextResponse.json({
        status: "SOLVED",
        targetHomes: targetHomes ?? null,
        ceilings: {
          legalDensity: result.legalDensityCeiling,
          massing: result.massingCeiling,
          physicalSite: result.physicalSiteCeiling,
          overall: result.overallCeiling,
        },
        geometry: {
          parcelAreaSqFt: Math.round(result.geometry.parcelAreaSqFt),
          preservedStructureAreaSqFt: Math.round(result.geometry.preservedStructureAreaSqFt),
          occupiedAreaCeilingPct: result.geometry.occupiedAreaCeilingPct,
          occupiedAreaCeilingSqFt: Math.round(result.geometry.occupiedAreaCeilingSqFt),
          heightCeilingFt: result.geometry.heightCeilingFt,
          floorsCap: result.geometry.floorsCap,
          parkingStallsRequired: result.geometry.parkingStallsRequired,
          parkingLandAreaSqFt: Math.round(result.geometry.parkingLandAreaSqFt),
          developableFootprintMaxSqFt: Math.round(result.geometry.developableFootprintMaxSqFt),
          warnings: result.geometry.warnings,
        },
        scenarios: result.scenarios.map((scenario) => ({
          label: scenario.label,
          homes: scenario.point.homes,
          parkingStalls: scenario.point.parkingStalls,
          parkingMargin: scenario.point.parkingMargin,
          footprintSqFt: scenario.point.footprintSqFt,
          floors: scenario.point.floors,
          confidence: scenario.confidence,
          professionalQuestions: scenario.professionalQuestions,
          results: scenario.results.map((r) => ({
            key: r.constraintKey,
            label: r.humanLabel,
            source: r.source,
            status: r.status,
            actual: r.actual ?? null,
            actualUnit: r.actualUnit ?? null,
            limit: r.limit ?? null,
            limitUnit: r.limitUnit ?? null,
            explanation: r.explanation,
          })),
        })),
        assumptions: result.inputs.assumptionIds.map((id) => {
          const node = project.nodes[id];
          if (node && node.kind === "assumption") {
            return {
              id,
              statement: node.statement,
              rationale: node.rationale,
              value:
                node.value.type === "quantity"
                  ? `${node.value.quantity.value} ${node.value.quantity.unit}`
                  : node.value.type,
            };
          }
          return { id };
        }),
        handoff: (() => {
          const handoff = buildGeometryHandoff(result);
          return {
            legalEnvelopeVerified: handoff.legalEnvelopeVerified,
            regions: handoff.regions.map((region) => ({
              role: region.role,
              geometryStatus: region.geometryStatus,
              areaSqFt: region.areaSqFt === null ? null : Math.round(region.areaSqFt),
            })),
            unresolved: handoff.unresolved,
          };
        })(),
      });
    }

    // NO_VERIFIED_SOLUTION — never softened into a "best effort" scenario.
    return NextResponse.json({
      status: "NO_VERIFIED_SOLUTION",
      targetHomes: result.requestedTarget,
      maxFeasibleHomes: result.maxFeasibleHomes,
      ceilings: result.ceilings,
      explanation: result.explanationInputs.join(" "),
      counterfactuals: result.counterfactuals,
      binding: result.binding.map((proof) => ({
        constraintKey: proof.constraintKey,
        humanLabel: proof.humanLabel,
        source: proof.source,
        currentLimit: proof.currentLimit,
        relaxedLimit: proof.relaxedLimit,
        capacityBefore: proof.capacityBefore,
        capacityAfter: proof.capacityAfter,
        capacityDeltaHomes: proof.capacityDelta,
        unit: proof.unit,
        explanation: proof.explanation,
        missionLocked: proof.missionLocked,
      })),
      nearestAlternatives: result.nearestAlternatives.map((alt) => ({
        homes: alt.homes,
        parkingStalls: alt.parkingStalls,
        parkingMargin: alt.parkingMargin,
        footprintSqFt: alt.footprintSqFt,
        floors: alt.floors,
      })),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    if (name === "SolveRefusal" || error instanceof SolveRefusal) {
      const refusal = error as SolveRefusal;
      return NextResponse.json({
        status: "REFUSED",
        reason: refusal.reason,
        message: refusal.message,
      });
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
      { error: error instanceof Error ? error.message : "solve failed", name },
      { status: 400 },
    );
  }
}
