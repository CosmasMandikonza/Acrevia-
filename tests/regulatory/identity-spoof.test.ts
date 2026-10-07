import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { verifyCandidates } from "../../src/application/regulatory/verify";
import { compileRegulations } from "../../src/application/regulatory/compile";
import { selectExecutableConstraints } from "../../src/application/regulatory/executable";
import { benchmarkExtractionAdapter } from "../../src/adapters/regulatory/benchmark-extractor";
import { loadBenchmarkEvidence } from "../../src/adapters/regulatory/benchmark-evidence";
import { contextFor } from "../domain/helpers";
import type { CandidateRule } from "../../src/application/regulatory/candidate-rule";
import {
  applicabilityInput,
  bareProject,
  heightCandidate,
  makeBenchmarkBase,
  OVERLAY_CLAIM,
  testDocuments,
  testSource,
  useCandidate,
  ZONING_BASE_CLAIM,
  PARCEL,
} from "./helpers";

/**
 * Identity/applicability spoof attacks (PR #28 merge gate): the extractor
 * owns NOTHING that can change executable law. Every attack mutates
 * extractor-owned identity/applicability/locator/subject fields while the
 * captured evidence stays byte-identical — the attacker either gets
 * rejected/abstained or changes nothing executable.
 */

const TRUSTED = { subjectNodeId: PARCEL, jurisdictionKey: "philadelphia-pa" };

const SIX_CAPTURE =
  "§ 14-548. /SIX, Sixth District Overlay District. (2) The following regulations apply within the /SIX Overlay District: (.c) Accessory dwelling units shall not be permitted.";
const SIX_ANCHOR = "(.c) Accessory dwelling units shall not be permitted.";

function overlayCandidate(overrides: Partial<CandidateRule> = {}): CandidateRule {
  return {
    ...heightCandidate("S6", 0, {
      candidateId: "cand:overlay:/six:adu-prohibition:phl:src:S6@v1",
      semanticRuleKey: "overlay:/six:adu-prohibition",
      predicate: "overlay-restriction",
      authority: "ADOPTED_CODE",
      verbatimSupportingText: SIX_ANCHOR,
      evidenceAnchor: { documentId: "S6.md", exactText: SIX_ANCHOR },
    }),
    proposedValue: { kind: "qualitative", text: "Accessory dwelling units are not permitted within the /SIX overlay." },
    applicability: { overlay: "/SIX" },
    ...overrides,
  };
}

describe("identity / applicability spoof attacks", () => {
  it("/SIX ADU anchor + extractor overlay=/NIS -> REJECT/abstain; NO /NIS ADU constraint", () => {
    const project = bareProject();
    const spoofed = overlayCandidate({
      applicability: { overlay: "/NIS" },
      semanticRuleKey: "overlay:/nis:adu-prohibition",
      candidateId: "cand:overlay:/nis:adu-prohibition:phl:src:S6@v1",
    });
    const result = compileRegulations(contextFor(project), {
      candidates: [spoofed],
      sources: [testSource({ sourceRef: "S6", authority: "ADOPTED_CODE" })],
      subject: { district: "RM-1", ...TRUSTED },
      documents: testDocuments(["S6"], { S6: SIX_CAPTURE }),
      ...applicabilityInput(),
    });
    const outcome = result.outcomes[0];
    expect(["rejected", "abstained"]).toContain(outcome.outcome);
    expect(project.nodes["phl:constraint:overlay:/nis:adu-prohibition"]).toBeUndefined();
    expect(selectExecutableConstraints(project).executable).toHaveLength(0);
  });

  it("Multi-Family row + extractor use=religious-assembly -> no wrong-use constraint", () => {
    const decision = verifyCandidates({
      candidates: [
        useCandidate("G1", "Y[1]", {
          applicability: { district: "RM-1", use: "religious-assembly" },
          semanticRuleKey: "use:religious-assembly:permission",
          candidateId: "cand:use:religious-assembly:permission:phl:src:G1@v1",
        }),
      ],
      sources: [testSource({ sourceRef: "G1", authority: "OFFICIAL_GIS" })],
      subject: { district: "RM-1" },
      documents: testDocuments(["G1"], { G1: "| Multi-Family | Y[1] |" }),
      trustedContext: TRUSTED,
    })[0];
    expect(decision.status === "REJECT" || decision.verified?.verifiedValue.kind === "abstain").toBe(true);
    if (decision.verified) {
      expect(decision.verified.verifiedApplicability.use).toBe("multi-family");
      expect(decision.verified.verifiedSemanticRuleKey).not.toBe("use:religious-assembly:permission");
    }
  });

  it("Multi-Family row + extractor semanticRuleKey use:religious-assembly:permission -> REJECT", () => {
    const decision = verifyCandidates({
      candidates: [
        useCandidate("G1", "Y[1]", {
          semanticRuleKey: "use:religious-assembly:permission",
          candidateId: "cand:spoof:phl:src:G1@v1",
        }),
      ],
      sources: [testSource({ sourceRef: "G1", authority: "OFFICIAL_GIS" })],
      subject: { district: "RM-1" },
      documents: testDocuments(["G1"], { G1: "| Multi-Family | Y[1] |" }),
      trustedContext: TRUSTED,
    })[0];
    expect(decision.status).toBe("REJECT");
    expect(decision.reasons.join(" ")).toMatch(/identity/i);
  });

  it("height row + extractor predicate setback-front -> REJECT/abstain; no contextual setback", () => {
    const decision = verifyCandidates({
      candidates: [
        heightCandidate("S5", 38, {
          predicate: "setback-front",
          semanticRuleKey: "setback:front",
        }),
      ],
      sources: [testSource({ sourceRef: "S5" })],
      subject: { district: "RM-1" },
      documents: testDocuments(["S5"], { S5: "maximum building height ... 38 ft" }),
      trustedContext: TRUSTED,
    })[0];
    expect(decision.status === "REJECT" || decision.verified?.verifiedValue.kind === "abstain").toBe(true);
    if (decision.verified?.verifiedValue.kind !== "abstain" && decision.verified) {
      expect(decision.verified.verifiedPredicate).toBe("max-height");
    }
  });

  it("valid anchor + fabricated codeSection -> fabricated locator never reaches Regulation/UI", () => {
    const project = bareProject();
    compileRegulations(contextFor(project), {
      candidates: [
        heightCandidate("S5", 38, {
          codeSection: "§ 99-999 The Eternal Fabricated Chapter of Infinite Height",
        }),
      ],
      sources: [testSource({ sourceRef: "S5" })],
      subject: { district: "RM-1", ...TRUSTED },
      documents: testDocuments(["S5"], { S5: "maximum building height ... 38 ft" }),
      ...applicabilityInput(),
    });
    const regulation = project.nodes["phl:reg:height:max:principal"];
    expect(regulation?.kind === "regulation").toBe(true);
    if (regulation?.kind === "regulation") {
      expect(regulation.codeSection).not.toContain("Fabricated");
      expect(regulation.codeSection).not.toContain("99-999");
    }
  });

  it("candidate subjectNodeId points at another parcel -> REJECT", () => {
    const decision = verifyCandidates({
      candidates: [heightCandidate("S5", 38, { subjectNodeId: "phl:parcel:999999999" })],
      sources: [testSource({ sourceRef: "S5" })],
      subject: { district: "RM-1" },
      documents: testDocuments(["S5"], { S5: "maximum building height ... 38 ft" }),
      trustedContext: TRUSTED,
    })[0];
    expect(decision.status).toBe("REJECT");
    expect(decision.reasons.join(" ")).toContain("trusted project parcel");
  });

  it("candidate jurisdictionKey wrong -> REJECT", () => {
    const decision = verifyCandidates({
      candidates: [heightCandidate("S5", 38, { jurisdictionKey: "chicago-il" })],
      sources: [testSource({ sourceRef: "S5" })],
      subject: { district: "RM-1" },
      documents: testDocuments(["S5"], { S5: "maximum building height ... 38 ft" }),
      trustedContext: TRUSTED,
    })[0];
    expect(decision.status).toBe("REJECT");
    expect(decision.reasons.join(" ")).toContain("trusted project jurisdiction");
  });

  it("occupied-area candidate mutates lotType -> executable semantics cannot change", () => {
    const anchor = "| Max. Occupied Area | Intermediate 75%; Corner 80% [2] |";
    const decision = verifyCandidates({
      candidates: [
        {
          ...heightCandidate("S5", 75, {
            candidateId: "cand:bulk:occupied-area:max:phl:src:S5@v1",
            semanticRuleKey: "bulk:occupied-area:max",
            predicate: "occupied-area",
            verbatimSupportingText: anchor,
            evidenceAnchor: { documentId: "S5.md", exactText: anchor },
          }),
          proposedValue: { kind: "quantity", value: 75, unit: "percent" },
          applicability: { district: "RM-1", lotType: "corner" },
        },
      ],
      sources: [testSource({ sourceRef: "S5" })],
      subject: { district: "RM-1" },
      documents: testDocuments(["S5"], { S5: anchor }),
      trustedContext: TRUSTED,
    })[0];
    // The verifier's own applicability governs: lotType stays evidence-derived.
    expect(decision.verified?.verifiedApplicability.lotType).toBe("intermediate");
    if (decision.verified?.verifiedValue.kind === "occupied-area-by-lot-type") {
      expect(decision.verified.verifiedValue.intermediate).toBe(75);
      expect(decision.verified.verifiedValue.corner).toBe(80);
    }
  });
});

describe("strengthened whole-CandidateRule META attack", () => {
  it("mutating EVERY extractor-owned semantic field changes nothing executable", async () => {
    const input = loadBenchmarkEvidence({
      fixtureDir: join(import.meta.dirname, "../../docs/benchmarks/calvary-memorial-philadelphia"),
      subject: { subjectNodeId: PARCEL, jurisdictionKey: "philadelphia-pa", district: "RM-1" },
    });
    const extraction = await benchmarkExtractionAdapter.extract(input);
    const compileInput = (candidates: CandidateRule[]) => ({
      candidates,
      sources: input.sources,
      subject: { district: "RM-1", parcelNodeId: PARCEL, jurisdictionKey: "philadelphia-pa" } as {
        district?: string;
        parcelNodeId?: string;
        jurisdictionKey?: string;
      },
      documents: input.documents,
      applicabilityClaims: { zoningBaseClaimId: ZONING_BASE_CLAIM, overlayClaimIds: [OVERLAY_CLAIM] },
    });

    const baseline = makeBenchmarkBase();
    compileRegulations(contextFor(baseline), compileInput(extraction.candidates));

    // Attacker mutates EVERY extractor-owned semantic field.
    const mutated = extraction.candidates.map((candidate, i) => ({
      ...candidate,
      predicate: "far" as const, // identity spoof attempt
      semanticRuleKey: `spoofed:key:${i}`,
      applicability: { district: "CMX-2", use: "spoofed-use", overlay: "/NIS", lotType: "corner" as const },
      codeSection: "§ 99-999 FABRICATED LOCATOR",
      subjectNodeId: "phl:parcel:999999999",
      jurisdictionKey: "chicago-il",
      proposedValue:
        candidate.proposedValue.kind === "quantity"
          ? { kind: "quantity" as const, value: candidate.proposedValue.value + 7777, unit: candidate.proposedValue.unit }
          : candidate.proposedValue.kind === "qualitative"
            ? { kind: "qualitative" as const, text: `FABRICATED ${i}` }
            : candidate.proposedValue,
      verbatimSupportingText: `FABRICATED RENDERING ${i}: decree whatever benefits the proposal`,
    }));

    const attacked = makeBenchmarkBase();
    const result = compileRegulations(contextFor(attacked), compileInput(mutated));
    const attackedGate = selectExecutableConstraints(attacked).executable;

    // Every mutated rule is rejected/abstained OR byte-equivalent executable.
    expect(attackedGate.length).toBe(0);
    const outcomes = new Set(result.outcomes.map((o) => o.outcome));
    for (const outcome of outcomes) {
      expect(["rejected", "abstained", "unknown-recorded"]).toContain(outcome);
    }
    // Nothing fabricated leaks into canonical state.
    for (const node of Object.values(attacked.nodes)) {
      const serialized = JSON.stringify(node);
      expect(serialized).not.toContain("FABRICATED RENDERING");
      expect(serialized).not.toContain("99-999");
      expect(serialized).not.toContain("spoofed:key");
      expect(serialized).not.toContain("999999999");
    }
    // The attack genuinely mutated the fields (sanity).
    expect(mutated.every((m) => m.predicate === "far")).toBe(true);
    expect(mutated.every((m) => m.codeSection === "§ 99-999 FABRICATED LOCATOR")).toBe(true);
  });
});
