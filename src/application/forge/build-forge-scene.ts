/**
 * Forge scene orchestration (issue #9).
 *
 * Runs the SAME trust pipeline as /api/solver/solve, deliberately ISOLATED
 * (no shared helper was extracted — the solver route must not move under
 * Forge): verify the accepted { envelope, receipt } pair, rebuild the
 * committed base project and hash-gate it, compile law from the captured
 * corpus exactly as /api/regulatory/compile does, replay the client's
 * mission command log through the typed boundary, seed solver assumptions,
 * solve, record scenarios with certificates, then derive the
 * SpatialSceneModel server-side. The client never authors geometry,
 * zoning, or solver results — it may only pick an existing scenario or
 * change a mission value, which re-enters through this same pipeline.
 *
 * Determinism: the returned scene carries no wall-clock (buildMs is
 * response metadata, outside the model); the input fingerprint digests
 * semantic state only (ids + revisions + semantic hashes, never
 * timestamps), so identical state yields identical fingerprints and
 * byte-identical scenes.
 */

import { createHash } from "node:crypto";
import type { ResolutionEnvelope } from "../../adapters/gis/resolution-envelope";
import type { CommitReceipt } from "../../adapters/gis/commit-receipt";
import {
  BaseProjectDriftError,
  type MissionCommand,
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
import { SOLVER_VERSION, solve } from "../solver/solve";
import { recordSolverScenarios } from "../solver/record";
import { buildForgeScene } from "../../adapters/spatial/forge-scene";
import { canonicalJson } from "../../domain/graph/serialization";
import type { SpatialSceneModel } from "../../spatial/scene-model";
import type { CommandContext } from "../../commands";

const FIXTURE_DIR = "docs/benchmarks/calvary-memorial-philadelphia";
const SUPPORTED_DISTRICTS = new Set(["RM-1"]);
const LAW_SOURCES = new Set(["S5", "S6", "S7"]);

function canonicalDistrict(raw: string | undefined): string | null {
  if (!raw) return null;
  const normalized = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (normalized === "RM1") return "RM-1";
  return raw.trim().toUpperCase();
}

export type ForgeMissionSummary = {
  constraints: Array<{ id: string; type: string; detail: string }>;
  minParking: number | null;
};

export type ForgeSceneOk = {
  status: "SOLVED" | "NO_VERIFIED_SOLUTION";
  scene: SpatialSceneModel;
  /** Semantic input fingerprint — stale detection between fetches. */
  fingerprint: string;
  mission: ForgeMissionSummary;
  targetHomes: number | null;
  buildMs: number;
};

export type ForgeSceneBlocked =
  | { status: "needs-evidence"; reason: string }
  | { status: "unsupported-district"; district: string; reason: string }
  | { status: "multi-parcel-unsupported"; reason: string };

export type ForgeSceneResult = ForgeSceneOk | ForgeSceneBlocked;

function missionDetail(normalized: { type: string; spaces?: { value: number }; structureId?: string; limit?: { value: number }; stories?: { value: number } }): string {
  switch (normalized.type) {
    case "min-parking":
      return `At least ${normalized.spaces?.value ?? "?"} Sunday parking spaces`;
    case "preserve-structure":
      return `Preserve ${normalized.structureId ?? "structure"}`;
    case "max-stories":
      return `At most ${normalized.stories?.value ?? "?"} stories`;
    case "retain-ownership":
      return "Congregation retains land ownership";
    case "max-height":
      return `No taller than ${normalized.limit?.value ?? "?"} ft`;
    default:
      return normalized.type;
  }
}

export async function buildForgeSceneResult(input: {
  envelope: ResolutionEnvelope;
  receipt: CommitReceipt;
  commands: MissionCommand[];
  targetHomes?: number;
}): Promise<ForgeSceneResult> {
  const t0 = Date.now();
  const { session, receiptPayload } = verifyAcceptedPair(input.envelope, input.receipt);
  const project = rebuildAcceptedProject(session, receiptPayload);
  const baseHash = sha256Project(ProjectCodec.encode(project));
  if (baseHash !== receiptPayload.projectHash) {
    throw new BaseProjectDriftError(
      "the accepted property's committed project could not be reproduced exactly; re-resolve and re-accept the property",
    );
  }
  if (session.confirmedParcelIds.length > 1 || session.parcelContexts.length > 1) {
    return {
      status: "multi-parcel-unsupported",
      reason:
        "This accepted property has multiple confirmed parcels; per-parcel scenes are required before Forge can render it.",
    };
  }

  const context = session.parcelContexts[0];
  const rawDistrict = context?.zoningBase?.districtLong ?? context?.zoningBase?.district;
  const district = canonicalDistrict(rawDistrict);
  const subjectNodeId = `gis:parcel:${session.confirmedParcelIds[0]}`;
  const parcelKey = session.confirmedParcelIds[0];
  const zoningBaseClaim = project.nodes[`gis:claim:zoning-base:${parcelKey}`];
  const overlayClaim = project.nodes[`gis:claim:zoning-overlays:${parcelKey}`];
  if (!district || !zoningBaseClaim || zoningBaseClaim.kind !== "claim") {
    return {
      status: "needs-evidence",
      reason:
        "The accepted property has no verified base zoning district claim in its signed session, so no law can be executed for it yet. Re-resolve the property.",
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

  const overlayNames = (context?.zoningOverlays?.overlays ?? []).map((o) => o.name ?? "");
  const sixProven =
    overlayNames.some((name) => /sixth district overlay/i.test(name)) &&
    overlayClaim?.kind === "claim";

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
  const ctx: CommandContext = { project, actor: "forge" };
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

  replayMissionCommands(project, input.commands, {
    actor: "church-leader",
    fallbackAt: receiptPayload.committedAt,
  });
  seedSolverAssumptions(ctx);

  const result = solve(project, input.targetHomes === undefined ? {} : { targetHomes: input.targetHomes });

  const recorded =
    result.status === "SOLVED" ? recordSolverScenarios(ctx, result) : [];

  const selectedAddress = session.selectedAddress;
  if (!selectedAddress || !Array.isArray(selectedAddress.point)) {
    throw new Error("verified session has no address point for orientation");
  }
  const scene = buildForgeScene({
    project,
    solveResult: result,
    recorded,
    addressHint: { lon: selectedAddress.point[0], lat: selectedAddress.point[1] },
    title: selectedAddress.matchedAddress ?? session.query,
    subtitle: `${district} · accepted Development Graph revision ${receiptPayload.revision}`,
  });

  // Semantic input fingerprint: accepted project identity + mission state +
  // solver version + goal. Never timestamps — a value edit changes the
  // semanticHash, which changes the fingerprint, which flips the client to
  // STALE before the replacement scene arrives.
  const missionState = Object.values(project.nodes)
    .filter((node) => node.kind === "mission-constraint")
    .map((node) => {
      const n = node as unknown as {
        id: string;
        meta?: { revision?: number; semanticHash?: string };
      };
      return { nodeId: n.id, revision: n.meta?.revision ?? -1, semanticHash: n.meta?.semanticHash ?? "" };
    })
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const fingerprint = createHash("sha256")
    .update(
      canonicalJson({
        projectId: receiptPayload.projectId,
        envelopeSignature: receiptPayload.envelopeSignature,
        missions: missionState,
        solverVersion: SOLVER_VERSION,
        targetHomes: input.targetHomes ?? null,
      }),
    )
    .digest("hex")
    .slice(0, 16);

  const missionNodes = Object.values(project.nodes)
    .filter((node) => node.kind === "mission-constraint")
    .map((node) => node as unknown as {
      id: string;
      confirmationState: string;
      normalized: { type: string; spaces?: { value: number }; structureId?: string; limit?: { value: number }; stories?: { value: number } };
    })
    .filter((node) => node.confirmationState === "CONFIRMED")
    .sort((a, b) => a.id.localeCompare(b.id));
  const minParkingNode = missionNodes.find((m) => m.normalized.type === "min-parking");

  return {
    status: result.status,
    scene,
    fingerprint,
    mission: {
      constraints: missionNodes.map((m) => ({
        id: m.id,
        type: m.normalized.type,
        detail: missionDetail(m.normalized),
      })),
      minParking: minParkingNode?.normalized.spaces?.value ?? null,
    },
    targetHomes: input.targetHomes ?? null,
    buildMs: Date.now() - t0,
  };
}
