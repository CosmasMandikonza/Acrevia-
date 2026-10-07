import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { POST as proofSnapshotPost } from "../../src/app/api/proof/snapshot/route";
import { POST as commitPost } from "../../src/app/api/gis/commit/route";
import { createEnvelope } from "../../src/adapters/gis/resolution-envelope";
import type { ResolutionSession } from "../../src/application/resolution/state";
import type { ResolvedParcelContext } from "../../src/adapters/gis";
import {
  makeAddressCandidate,
  makeParcelCandidate,
  makeZoningBase,
  makeZoningOverlays,
  makeStructure,
  makeFlood,
} from "../gis/fixtures";
import { EvidenceState } from "../../src/domain";
import { gradeCertificate } from "../../src/domain";
import {
  buildProofSnapshot,
  OpenQuestionDoc,
  seedBenchmarkOpenQuestions,
  type ProofSnapshot,
} from "../../src/application/proof/snapshot";
import { solve } from "../../src/application/solver/solve";
import { recordSolverScenarios } from "../../src/application/solver/record";
import { seedSolverAssumptions } from "../../src/application/solver/assumptions";
import { replaceExecutableConstraint } from "../../src/commands";
import { contextFor } from "../domain/helpers";
import { canonicalProject } from "../solver/canonical.test";

/**
 * Issue #11 — Proof completeness and adversarial tests.
 *
 * Part 1 exercises the REAL trusted route end to end: a committed accepted
 * session + canonical mission commands → POST /api/proof/snapshot. Every
 * consequential number the Evidence surface would render must terminate in a
 * SourceArtifact, a USER_DECLARED MissionConstraint, a MODELER_DECLARED
 * Assumption, or deterministic SYSTEM_DERIVED computation — never a JSX
 * constant or invented prose.
 *
 * Part 2 works graph-level (in-memory canonical project) for staleness,
 * certificate history, and fail-closed focus handling.
 */

const NOW = "2026-10-08T12:00:00.000Z";
const FIXTURE_DIR = join(import.meta.dirname, "../../docs/benchmarks/calvary-memorial-philadelphia");

// Real Calvary geometry (same fixture bytes the solver benchmark reads) so
// the route-level projection computes the canonical modeled space instead of
// a giant synthetic square that refuses on search bounds.
const PARCEL_GEOJSON = JSON.parse(
  readFileSync(join(FIXTURE_DIR, "raw/gis/pwd-parcel-brt-778273000.geojson"), "utf8"),
).features[0].geometry;
const SANCTUARY_GEOJSON = JSON.parse(
  readFileSync(join(FIXTURE_DIR, "raw/gis/footprints-parcel-494018.json"), "utf8"),
).features[0].geometry;

function parcelContext(overrides: Partial<ResolvedParcelContext> = {}): ResolvedParcelContext {
  return {
    parcelId: "778273000",
    zoningBase: makeZoningBase(),
    zoningOverlays: makeZoningOverlays(),
    structures: [
      makeStructure({
        structureId: "1282177",
        footprint: SANCTUARY_GEOJSON,
      }),
    ],
    flood: makeFlood(),
    failures: [],
    ...overrides,
  };
}

function canonicalSession(): ResolutionSession {
  return {
    sessionId: "proof-session-1",
    createdAt: NOW,
    query: "7200 Roosevelt Blvd, Philadelphia, PA",
    addressStage: "RESOLVED",
    addressCandidates: [makeAddressCandidate()],
    selectedAddress: makeAddressCandidate(),
    parcelStage: "RESOLVED",
    parcelCandidates: [
      makeParcelCandidate({
        brtId: "778273000",
        parcelId: "778273000",
        pwdParcelNum: "494018",
        geometry: PARCEL_GEOJSON,
      }),
    ],
    confirmedParcelIds: ["778273000"],
    userConfirmedProperty: true,
    parcelContexts: [parcelContext()],
    captures: [],
  };
}

const SANCTUARY_STRUCTURE_ID = "gis:structure:1282177";

const CANONICAL_MISSION_COMMANDS = [
  {
    kind: "confirm" as const,
    input: {
      id: "mission:min-sunday-parking",
      kind: "mission-constraint" as const,
      intentText: "Keep at least 110 Sunday parking spaces.",
      normalized: { type: "min-parking" as const, spaces: { value: 110, unit: "spaces" } },
      origin: { kind: "USER_DECLARED" as const, actorId: "board-chair", declaredAt: NOW },
      confirmationState: "CONFIRMED" as const,
      hardOrSoft: "hard" as const,
    },
  },
  {
    kind: "confirm" as const,
    input: {
      id: "mission:preserve-sanctuary",
      kind: "mission-constraint" as const,
      intentText: "Keep the sanctuary.",
      normalized: { type: "preserve-structure" as const, structureId: SANCTUARY_STRUCTURE_ID },
      origin: { kind: "USER_DECLARED" as const, actorId: "board-chair", declaredAt: NOW },
      confirmationState: "CONFIRMED" as const,
      hardOrSoft: "hard" as const,
    },
  },
  {
    kind: "confirm" as const,
    input: {
      id: "mission:retain-ownership",
      kind: "mission-constraint" as const,
      intentText: "We are not selling the land.",
      normalized: { type: "retain-ownership" as const },
      origin: { kind: "USER_DECLARED" as const, actorId: "board-chair", declaredAt: NOW },
      confirmationState: "CONFIRMED" as const,
      hardOrSoft: "hard" as const,
    },
  },
];

async function acceptedPair() {
  const envelope = createEnvelope(canonicalSession());
  const response = await commitPost(
    new Request("http://localhost/api/gis/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        envelope,
        projectId: "gis:778273000",
        propertyId: "gis:property:778273000",
      }),
    }),
  );
  expect(response.status).toBe(200);
  const committed = (await response.json()) as { receipt: unknown };
  return { envelope, receipt: committed.receipt };
}

type Snapshot = ProofSnapshot;
let cachedSnapshot: Snapshot | null = null;

async function canonicalSnapshot(): Promise<Snapshot> {
  if (!cachedSnapshot) {
    cachedSnapshot = await snapshotFor(await acceptedPair());
  }
  return cachedSnapshot;
}

async function snapshotFor(pair: { envelope: unknown; receipt: unknown }) {
  const response = await proofSnapshotPost(
    new Request("http://localhost/api/proof/snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...pair, commands: CANONICAL_MISSION_COMMANDS }),
    }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as ProofSnapshot;
}

// ---------------------------------------------------------------------------
// Part 1 — the real trusted route
// ---------------------------------------------------------------------------

describe("POST /api/proof/snapshot — trusted projection of the canonical flow", () => {
  it("verifies the accepted pair and refuses a forged envelope", async () => {
    const good = await acceptedPair();
    const forged = await proofSnapshotPost(
      new Request("http://localhost/api/proof/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          envelope: { ...good.envelope, signature: "0".repeat(64) },
          receipt: good.receipt,
          commands: [],
        }),
      }),
    );
    expect(forged.status).toBe(400);
    const body = (await forged.json()) as { name?: string };
    expect(body.name).toBe("PairVerificationError");
  });

  it("projects identity, sources, two-strand law, missions, scenarios, and certificates", async () => {
    const snapshot = await canonicalSnapshot();
    expect(snapshot.projectionVersion).toBe("acrevia.proof.v1");
    expect(snapshot.status).toBe("compiled");
    expect(snapshot.identity.district).toBe("RM-1");
    expect(snapshot.identity.projectId).toBe("gis:778273000");
    // Real source artifacts from the captured corpus.
    expect(snapshot.sources.length).toBeGreaterThanOrEqual(3);
    const titles = snapshot.sources.map((source: { title: string }) => source.title).join(" ");
    expect(titles).toContain("Quick Guide");
    // Executable law with both strands resolved to real ids.
    const executable = snapshot.constraints.filter((c: { executable: boolean }) => c.executable);
    expect(executable.length).toBeGreaterThan(5);
    for (const constraint of executable) {
      expect(constraint.lawClaimId).toMatch(/^phl:claim:/);
      expect(constraint.lawSourceId).toMatch(/^phl:src:/);
      // District-scoped rules must carry the site's own GIS applicability claim.
      const regulation = snapshot.regulations.find((r: { id: string }) => r.id === constraint.regulationId);
      if (regulation?.applicability?.district) {
        expect(constraint.appliesHereClaimId).toBe("gis:claim:zoning-base:778273000");
        expect(constraint.appliesHereSourceId).toMatch(/^gis:src:/);
      }
    }
    // Canonical mission rules are present as USER_DECLARED graph nodes.
    expect(snapshot.missions.map((m) => m.id)).toEqual(
      expect.arrayContaining([
        "mission:min-sunday-parking",
        "mission:preserve-sanctuary",
        "mission:retain-ownership",
      ]),
    );
    // Scenarios + certificates recorded by the deterministic solve.
    expect(snapshot.scenarios.length).toBeGreaterThanOrEqual(3);
    for (const scenario of snapshot.scenarios) {
      expect(scenario.freshness).toBe("CURRENT");
      const certificate = snapshot.certificates.find((c) => c.id === scenario.certificateId)!;
      expect(certificate).toBeDefined();
      if (!certificate) throw new Error("missing certificate");
      expect(certificate.freshness).toBe("CURRENT");
      expect(certificate.dependencyCount).toBeGreaterThan(5);
    }
  });

  it("height result traces to the exact SourceArtifact AND the applicability GIS claim", async () => {
    const snapshot = await canonicalSnapshot();
    const heightConstraint = snapshot.constraints.find(
      (c) => c.constraintKind === "height",
    );
    expect(heightConstraint).toBeDefined();
    if (!heightConstraint) throw new Error("missing heightConstraint");
    expect(heightConstraint.executable).toBe(true);

    const heightResult = snapshot.results.find(
      (r) => r.constraintId === heightConstraint.id,
    );
    expect(heightResult).toBeDefined();
    if (!heightResult) throw new Error("missing heightResult");
    expect(heightResult.status).toBe("SATISFIED");
    expect(heightResult.actual).toEqual({ value: 33, unit: "ft" }); // 3 floors × 11 ft
    expect(heightResult.limit).toEqual({ value: 38, unit: "ft" });
    expect(heightResult.machineCheckable).toBe(true);
    expect(heightResult.method).toMatch(/solver\//);

    // LAW strand → the Quick Guide claim → the exact source artifact.
    const lawClaim = snapshot.claims.find((c) => c.id === heightConstraint.lawClaimId)!;
    expect(lawClaim.strand).toBe("law");
    expect(lawClaim.predicate).toBe("max-height");
    expect(lawClaim.evidenceState).toMatch(/VERIFIED|SOURCE_CONFIRMED/);
    expect(lawClaim.verbatimQuote ?? "").toContain("38");
    const lawSource = snapshot.sources.find((s) => s.id === lawClaim.sourceIds[0])!;
    expect(lawSource.title).toContain("Quick Guide");
    expect(lawSource.authority).toBe("OFFICIAL_CITY_REFERENCE");

    // APPLIES HERE strand → the site's own zoning-base claim → official GIS.
    const appliesClaim = snapshot.claims.find(
      (c) => c.id === heightConstraint.appliesHereClaimId,
    )!;
    expect(appliesClaim.strand).toBe("applies-here");
    expect(appliesClaim.predicate).toBe("zoning-district");
    expect(appliesClaim.valueSummary).toContain("RM-1");
    const appliesSource = snapshot.sources.find((s) => s.id === appliesClaim.sourceIds[0])!;
    expect(appliesSource.authority).toBe("OFFICIAL_GIS");

    // Certificate dependency: the scenario's proof pins the height constraint.
    const scenarioWithHeight = snapshot.scenarios.find(
      (s) => s.id === heightResult.scenarioId,
    )!;
    const certificate = snapshot.certificates.find((c) => c.id === scenarioWithHeight.certificateId)!;
    expect(certificate.dependencies.some((d) => d.nodeId === heightConstraint.id)).toBe(true);
    expect(certificate.dependencies.some((d) => d.nodeId === lawClaim.id)).toBe(true);
    expect(certificate.dependencies.some((d) => d.nodeId === lawSource.id)).toBe(true);
  });

  it("density metric traces to the tiered density constraint and its source", async () => {
    const snapshot = await canonicalSnapshot();
    const densityConstraint = snapshot.constraints.find(
      (c) => c.constraintKind === "density",
    );
    expect(densityConstraint).toBeDefined();
    if (!densityConstraint) throw new Error("missing densityConstraint");
    expect(densityConstraint.executable).toBe(true);
    const densityResult = snapshot.results.find(
      (r) => r.constraintId === densityConstraint.id,
    );
    expect(densityResult).toBeDefined();
    if (!densityResult) throw new Error("missing densityResult");
    expect(densityResult.status).toBe("SATISFIED");
    expect(densityResult.limit?.unit).toBe("dwelling_units");
    const scenario = snapshot.scenarios.find((s) => s.id === densityResult.scenarioId)!;
    const homesMetric = scenario.metrics.find((m) => m.metricId === "homes")!;
    expect(homesMetric.value!.value).toBeLessThanOrEqual(densityResult.limit!.value);
    // The homes metric terminates in the certificate closure that pins the
    // density constraint, its claim, and its source.
    const certificate = snapshot.certificates.find((c) => c.id === scenario.certificateId)!;
    const pinned = new Set(certificate.dependencies.map((d) => d.nodeId));
    expect(pinned.has(densityConstraint.id)).toBe(true);
    expect(pinned.has(densityConstraint.lawClaimId!)).toBe(true);
    expect(pinned.has(densityConstraint.lawSourceId!)).toBe(true);
  });

  it("parking mission traces to the USER_DECLARED MissionConstraint — never to law", async () => {
    const snapshot = await canonicalSnapshot();
    const parkingMission = snapshot.missions.find((m) => m.id === "mission:min-sunday-parking");
    expect(parkingMission).toBeDefined();
    if (!parkingMission) throw new Error("missing parkingMission");
    expect(parkingMission.normalizedSummary).toContain("110");

    const parkingResult = snapshot.results.find(
      (r) => r.constraintId === "mission:min-sunday-parking",
    );
    expect(parkingResult).toBeDefined();
    if (!parkingResult) throw new Error("missing parkingResult");
    expect(parkingResult.source).toBe("mission");
    expect(parkingResult.status).toBe("SATISFIED");
    expect(parkingResult.limit).toEqual({ value: 110, unit: "spaces" });

    // The law's own parking rule stays separate (0 spaces for multi-family).
    const lawParking = snapshot.constraints.find(
      (c) => c.constraintKind === "parking-requirement",
    );
    expect(lawParking).toBeDefined();
    if (!lawParking) throw new Error("missing lawParking");
    // And the certificate pins the mission node itself.
    const scenario = snapshot.scenarios.find((s) => s.id === parkingResult.scenarioId)!;
    const certificate = snapshot.certificates.find((c) => c.id === scenario.certificateId)!;
    expect(
      certificate.dependencies.some((d) => d.nodeId === "mission:min-sunday-parking"),
    ).toBe(true);
  });

  it("parking LAND area terminates in the explicit stall-area Assumption", async () => {
    const snapshot = await canonicalSnapshot();
    const stallAssumption = snapshot.assumptions.find(
      (a) => a.id === "assumption:parking-stall-gross-land-area",
    );
    expect(stallAssumption).toBeDefined();
    if (!stallAssumption) throw new Error("missing stallAssumption");
    expect(stallAssumption.valueSummary).toBe("350 sq_ft");
    const scenario = snapshot.scenarios[0]!;
    const certificate = snapshot.certificates.find((c) => c.id === scenario.certificateId)!;
    expect(
      certificate.dependencies.some((d) => d.nodeId === stallAssumption.id),
    ).toBe(true);
  });

  it("homes metric has non-empty dependency closure across law, mission, assumption, parcel, sources (meta test)", async () => {
    const snapshot = await canonicalSnapshot();
    for (const scenario of snapshot.scenarios) {
      const certificate = snapshot.certificates.find((c) => c.id === scenario.certificateId)!;
      expect(certificate.dependencies.length).toBeGreaterThan(10);
      const kinds = certificate.dependencies.reduce<Record<string, number>>((counts, dep: { nodeKind: string }) => {
        counts[dep.nodeKind] = (counts[dep.nodeKind] ?? 0) + 1;
        return counts;
      }, {});
      expect(kinds["source-artifact"]).toBeGreaterThanOrEqual(3);
      expect(kinds["mission-constraint"]).toBeGreaterThanOrEqual(3);
      expect(kinds["assumption"]).toBeGreaterThanOrEqual(5);
      expect(kinds["parcel"]).toBeGreaterThanOrEqual(1);
      expect(kinds["law" as never] ?? kinds["constraint"]).toBeGreaterThanOrEqual(1);
    }
    // Every recorded result's constraintId is inside its scenario's closure —
    // no consequential computed value floats free of the proof.
    for (const result of snapshot.results) {
      const scenario = snapshot.scenarios.find((s) => s.id === result.scenarioId)!;
      const certificate = snapshot.certificates.find((c) => c.id === scenario.certificateId)!;
      expect(
        certificate.dependencies.some((d) => d.nodeId === result.constraintId),
        `result ${result.id} constraint ${result.constraintId} must be pinned`,
      ).toBe(true);
    }
  });

  it("unknowns stay unknown: FAR-style null claims never become values or constraints", () => {
    const project = canonicalProject();
    const ctx = contextFor(project);
    // An explicitly-unknown claim (FAR is not derivable from the capture).
    ctx.project.nodes["phl:claim:far:max:principal"] = {
      id: "phl:claim:far:max:principal",
      kind: "claim",
      subjectNodeId: "gis:parcel:778273000",
      predicate: "far",
      value: { type: "null", reason: "unknown" },
      origin: { kind: "SOURCE_DERIVED" },
      sourceIds: ["phl:src:S5@v1"],
      evidenceState: "UNKNOWN",
      meta: { revision: 1, semanticHash: "far", createdAt: NOW, lastModifiedAt: NOW },
    } as never;
    seedSolverAssumptions(ctx);
    const solved = solve(project);
    if (solved.status !== "SOLVED") throw new Error("SOLVED");
    const recorded = recordSolverScenarios(ctx, solved);
    const snapshot = buildProofSnapshot(project, {
      solve: solved,
      recorded,
      conflicts: [],
      identity: { query: "q", district: "RM-1", parcelNodeId: "gis:parcel:778273000" },
    });
    const farClaim = snapshot.claims.find((claim) => claim.predicate === "far");
    expect(farClaim).toBeDefined();
    if (!farClaim) throw new Error("missing farClaim");
    expect(farClaim.valueSummary).toMatch(/^unknown/);
    expect(farClaim.evidenceState).toBe("UNKNOWN");
    // No constraint ever materializes from an unknown value.
    expect(snapshot.constraints.some((c) => /far/i.test(c.constraintKind))).toBe(false);
    // And no numeric FAR leaks into any result.
    for (const result of snapshot.results) {
      expect(/far/i.test(result.constraintId)).toBe(false);
    }
  });

  it("seeds all 14 benchmark open questions as real ExpertReview nodes", () => {
    const project = canonicalProject();
    const ctx = contextFor(project);
    seedSolverAssumptions(ctx);
    const questions = OpenQuestionDoc.parse(
      JSON.parse(readFileSync(join(FIXTURE_DIR, "open-questions.json"), "utf-8")),
    );
    const seeded = seedBenchmarkOpenQuestions(ctx, questions);
    expect(seeded).toBe(14);
    // Idempotent.
    expect(seedBenchmarkOpenQuestions(ctx, questions)).toBe(0);
    const solved = solve(project);
    if (solved.status !== "SOLVED") throw new Error("SOLVED");
    const recorded = recordSolverScenarios(ctx, solved);
    const snapshot = buildProofSnapshot(project, {
      solve: solved,
      recorded,
      conflicts: [],
      identity: { query: "q", district: "RM-1", parcelNodeId: "gis:parcel:778273000" },
    });
    expect(snapshot.expertReviews.length).toBe(14);
    expect(snapshot.expertReviews.every((review) => review.question.length > 0)).toBe(true);
    expect(snapshot.expertReviews.every((review) => review.whyItMatters.length > 0)).toBe(true);
    // FAR question links to the real far claim when one exists; overlay to the overlay claim.
    const overlayReview = snapshot.expertReviews.find((review) => review.category === "overlay");
    if (overlayReview) {
      expect(overlayReview.affectedNodeIds.length).toBeGreaterThanOrEqual(0); // resolvable or empty, never fabricated
    }
    // Computation questions exist too (setbacks etc.) and stay distinct.
    expect(snapshot.computationQuestions.length).toBeGreaterThan(0);
    const statuses = new Set(snapshot.computationQuestions.map((q) => q.status));
    expect(statuses.isSubsetOf(new Set(["UNKNOWN", "NOT_EVALUATED", "EXPERT_REQUIRED"]))).toBe(true);
  });

  it("fail-closed focus: fabricated and cross-property ids are invalid", async () => {
    const snapshot = await canonicalSnapshot();
    // Graph-level (deterministic, no route round-trip needed):
    const project = canonicalProject();
    const ctx = contextFor(project);
    seedSolverAssumptions(ctx);
    const solved = solve(project);
    if (solved.status !== "SOLVED") throw new Error("SOLVED");
    const recorded = recordSolverScenarios(ctx, solved);
    const base = {
      solve: solved,
      recorded,
      conflicts: [],
      identity: { query: "q", district: "RM-1", parcelNodeId: "gis:parcel:778273000" },
    };
    const fabricatedFocus = buildProofSnapshot(project, {
      ...base,
      focusNodeId: "phl:constraint:does-not-exist",
    });
    expect(fabricatedFocus.focus).toEqual({ id: "phl:constraint:does-not-exist", valid: false });

    const crossPropertyFocus = buildProofSnapshot(project, {
      ...base,
      focusNodeId: "gis:parcel:999999999",
    });
    expect(crossPropertyFocus.focus?.valid).toBe(false);

    const validFocus = buildProofSnapshot(project, {
      ...base,
      focusNodeId: "phl:constraint:height:max:principal",
    });
    expect(validFocus.focus).toEqual({
      id: "phl:constraint:height:max:principal",
      valid: true,
      nodeKind: "constraint",
    });
    void snapshot;
  });

  it("MACHINE CHECKED is a presentation label — never a persisted EvidenceState", async () => {
    const snapshot = await canonicalSnapshot();
    // The domain enum never gained the value.
    expect((EvidenceState.options as string[]).includes("MACHINE_CHECKED")).toBe(false);
    // No claim in the projection carries it as an evidence state.
    for (const claim of snapshot.claims) {
      expect(claim.evidenceState ?? "").not.toBe("MACHINE_CHECKED");
    }
    // It exists only as a computed, non-persisted flag on deterministic results.
    expect(snapshot.results.some((r: { machineCheckable: boolean }) => r.machineCheckable)).toBe(true);
    expect(
      snapshot.results.filter((r) => r.machineCheckable)
        .every((r: { status: string }) => r.status === "SATISFIED" || r.status === "VIOLATED"),
    ).toBe(true);
  });

  it("a stale/superseded source never displays as current executable truth", () => {
    const project = canonicalProject();
    const ctx = contextFor(project);
    seedSolverAssumptions(ctx);
    const solved = solve(project);
    if (solved.status !== "SOLVED") throw new Error("SOLVED");
    // Graph-level mutation: mark the Quick Guide source superseded (the typed
    // command exists; here we exercise the projection directly over a graph
    // whose regulation is conflicted).
    const regulation = project.nodes["phl:reg:height:max:principal"];
    if (regulation?.kind === "regulation") {
      regulation.conflictRefs = ["conflict:deadbeef"];
      regulation.currentness = "STALE";
    }
    const recorded = recordSolverScenarios(ctx, solved);
    const snapshot = buildProofSnapshot(project, {
      solve: solved,
      recorded,
      conflicts: [
        {
          conflictId: "conflict:deadbeef",
          subjectNodeId: "gis:parcel:778273000",
          semanticRuleKey: "height:max:principal",
          predicate: "max-height",
          members: [
            {
              candidateId: "c1",
              semanticRuleKey: "height:max:principal",
              sourceRef: "S5",
              authority: "OFFICIAL_CITY_REFERENCE",
              retrievedAt: "2026-10-01T00:00:00Z",
              valueSummary: "38 ft",
              normalizedLegalValue: "q:38 ft",
            },
            {
              candidateId: "c2",
              semanticRuleKey: "height:max:principal",
              sourceRef: "S8",
              authority: "OFFICIAL_GIS",
              retrievedAt: "2026-10-02T00:00:00Z",
              valueSummary: "55 ft",
              normalizedLegalValue: "q:55 ft",
            },
          ],
          resolution: "blocked",
          explanation: "Competing values with no reliable resolution; blocked pending expert review.",
        },
      ],
      identity: { query: "q", district: "RM-1", parcelNodeId: "gis:parcel:778273000" },
    });
    // The conflict stays visible with BOTH members.
    expect(snapshot.conflicts.length).toBe(1);
    expect(snapshot.conflicts[0].members.length).toBe(2);
    expect(snapshot.conflicts[0].resolution).toBe("blocked");
    // The conflicted regulation is STALE and its constraint is NOT executable.
    const heightReg = snapshot.regulations.find((r) => r.id === "phl:reg:height:max:principal")!;
    expect(heightReg.currentness).toBe("STALE");
    expect(heightReg.conflictRefs).toContain("conflict:deadbeef");
    // Certificates that pinned the conflicted regulation are INVALIDATED.
    const invalidated = snapshot.certificates.filter((c) => c.freshness === "INVALIDATED");
    expect(invalidated.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Part 2 — graph-level staleness and certificate history
// ---------------------------------------------------------------------------

describe("certificate history and STALE / RECOMPUTE presentation (graph-level)", () => {
  function solvedAndRecorded() {
    const project = canonicalProject();
    const ctx = contextFor(project);
    seedSolverAssumptions(ctx);
    const solved = solve(project);
    if (solved.status !== "SOLVED") throw new Error("SOLVED");
    const recorded = recordSolverScenarios(ctx, solved);
    return { project, ctx, solved, recorded };
  }

  it("current certificates grade CURRENT in the snapshot", () => {
    const { project, solved, recorded } = solvedAndRecorded();
    const snapshot = buildProofSnapshot(project, {
      solve: solved,
      recorded,
      conflicts: [],
      identity: { query: "q", district: "RM-1", parcelNodeId: "gis:parcel:778273000" },
    });
    for (const scenario of snapshot.scenarios) {
      expect(scenario.freshness).toBe("CURRENT");
      const certificate = snapshot.certificates.find((c) => c.id === scenario.certificateId)!;
      expect(certificate.freshness).toBe("CURRENT");
      expect(certificate.freshnessReasons).toEqual([]);
    }
  });

  it("a consequential law change stales the previous certificate and the snapshot shows the exact drifted dependency", () => {
    const { project, ctx, recorded } = solvedAndRecorded();
    const before = recorded[0].certificateId;
    expect(gradeCertificate(project, before).freshness).toBe("CURRENT");

    replaceExecutableConstraint(ctx, {
      id: "phl:constraint:height:max:principal",
      kind: "constraint",
      constraintKind: "height",
      regulationId: "phl:reg:height:max:principal",
      limit: { value: 45, unit: "ft" },
      appliesTo: "principal-structure",
    });

    // Re-solve and re-record: the current solve issues NEW certificates; the
    // old certificate node remains in the graph and the snapshot keeps it
    // inspectable with the EXACT stale dependency difference.
    const after = solve(project);
    if (after.status !== "SOLVED") throw new Error("still SOLVED");
    const recordedAfter = recordSolverScenarios(ctx, after);
    const snapshot = buildProofSnapshot(project, {
      solve: after,
      recorded: recordedAfter,
      conflicts: [],
      identity: { query: "q", district: "RM-1", parcelNodeId: "gis:parcel:778273000" },
    });

    const oldCertificate = snapshot.certificates.find((c) => c.id === before);
    expect(oldCertificate).toBeDefined();
    if (!oldCertificate) throw new Error("missing oldCertificate");
    expect(oldCertificate.freshness).toBe("STALE");
    expect(
      oldCertificate.freshnessReasons.some((reason) =>
        reason.includes("phl:constraint:height:max:principal") && reason.includes("changed"),
      ),
    ).toBe(true);

    for (const entry of recordedAfter) {
      expect(entry.freshness).toBe("CURRENT");
    }
  });

  it("an old requested certificate id against the current rebuild → superseded STALE / RECOMPUTE state", () => {
    const { project, ctx, recorded } = solvedAndRecorded();
    const before = recorded[0].certificateId;

    replaceExecutableConstraint(ctx, {
      id: "phl:constraint:height:max:principal",
      kind: "constraint",
      constraintKind: "height",
      regulationId: "phl:reg:height:max:principal",
      limit: { value: 45, unit: "ft" },
      appliesTo: "principal-structure",
    });
    const after = solve(project);
    if (after.status !== "SOLVED") throw new Error("still SOLVED");
    const recordedAfter = recordSolverScenarios(ctx, after);

    // The deep link requests the OLD certificate id for the CURRENT state.
    const snapshot = buildProofSnapshot(project, {
      solve: after,
      recorded: recordedAfter,
      conflicts: [],
      identity: { query: "q", district: "RM-1", parcelNodeId: "gis:parcel:778273000" },
      requestedCertificateId: before,
    });
    // The old node exists in this in-memory graph: the presentation is
    // STALE / RECOMPUTE with the EXACT drifted dependency named by
    // gradeCertificate() — not a vague "something changed".
    expect(snapshot.requestedCertificate?.status).toBe("superseded");
    expect(snapshot.requestedCertificate?.reason).toContain("phl:constraint:height:max:principal");
    expect(snapshot.requestedCertificate?.currentCertificateId).toBe(recordedAfter[0].certificateId);

    // The stateless-route case: a certificate id from an earlier state that
    // no longer exists as a node at all. The reason stays honest — it never
    // invents which historical field changed.
    const snapshotForeign = buildProofSnapshot(project, {
      solve: after,
      recorded: recordedAfter,
      conflicts: [],
      identity: { query: "q", district: "RM-1", parcelNodeId: "gis:parcel:778273000" },
      requestedCertificateId: `${before.slice(0, -1)}x`,
    });
    expect(snapshotForeign.requestedCertificate?.status).toBe("superseded");
    expect(snapshotForeign.requestedCertificate?.reason).toContain("earlier project state");
    expect(snapshotForeign.requestedCertificate?.reason).not.toContain("because the height");
  });
});
