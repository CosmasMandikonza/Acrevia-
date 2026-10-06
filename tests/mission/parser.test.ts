import { describe, expect, it } from "vitest";
import { interpretMission } from "../../src/application/mission/parser";

/**
 * Mission Compiler parser (issue #6) — deterministic typed interpretation.
 *
 * Adversarial contract: fuzzy language never becomes a hard constraint;
 * contradictions surface instead of resolving; unsupported goals are honest;
 * structures are never silently chosen; extreme-but-positive quantities stay
 * valid with an explicit "feasibility not tested yet" note. The parser is
 * deterministic — identical input and structure context always produce
 * identical output (verified in the determinism test).
 */

const ONE_STRUCTURE = [{ structureId: "884304900:main", name: "CALVARY MEMORIAL CHURCH" }];
const TWO_STRUCTURES = [
  { structureId: "884304900:main", name: "CALVARY MEMORIAL CHURCH" },
  { structureId: "884304900:annex", name: "EDUCATIONAL WING" },
];

describe("mission parser — canonical interpretations", () => {
  it("reads the canonical three-rule sentence into three proposals", () => {
    const result = interpretMission(
      "Keep the sanctuary. Keep at least 110 Sunday parking spaces. We don't want to sell the land.",
      { structures: ONE_STRUCTURE },
    );
    expect(result.proposals).toHaveLength(3);
    expect(result.conflicts).toHaveLength(0);
    expect(result.needsClarification).toHaveLength(0);

    const byType = Object.fromEntries(result.proposals.map((p) => [p.normalized.type, p]));
    expect(byType["min-parking"]).toMatchObject({
      proposalId: "mission:min-sunday-parking",
      normalized: { type: "min-parking", spaces: { value: 110, unit: "spaces" } },
      hardOrSoft: "hard",
    });
    expect(byType["preserve-structure"]).toMatchObject({
      proposalId: "mission:preserve:884304900:main",
      normalized: { type: "preserve-structure", structureId: "884304900:main" },
    });
    expect(byType["retain-ownership"]).toMatchObject({
      proposalId: "mission:retain-ownership",
      normalized: { type: "retain-ownership" },
    });
  });

  it("reads 'We are not selling the land' as ownership", () => {
    const result = interpretMission("We are not selling the land.", { structures: ONE_STRUCTURE });
    expect(result.proposals.map((p) => p.normalized.type)).toEqual(["retain-ownership"]);
  });

  it("reads mission-preferred maximum stories including number words", () => {
    const result = interpretMission("Keep the development below three stories.", {
      structures: ONE_STRUCTURE,
    });
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].normalized).toEqual({
      type: "max-stories",
      stories: { value: 3, unit: "stories" },
    });
  });

  it("reads mission-preferred maximum height", () => {
    const result = interpretMission("No building taller than 45 feet.", {
      structures: ONE_STRUCTURE,
    });
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].normalized).toEqual({
      type: "max-height",
      limit: { value: 45, unit: "ft" },
    });
  });

  it("treats explicitly preferred rules as soft", () => {
    const result = interpretMission("We would like to keep at least 40 Sunday parking spaces if possible.", {
      structures: ONE_STRUCTURE,
    });
    expect(result.proposals[0].hardOrSoft).toBe("soft");
  });
});

describe("mission parser — refuses to fabricate", () => {
  it("'Parking is important.' never becomes a number", () => {
    const result = interpretMission("Parking is important.", { structures: ONE_STRUCTURE });
    expect(result.proposals).toHaveLength(0);
    expect(result.needsClarification).toHaveLength(1);
    expect(result.needsClarification[0].suggestion).toContain("110");
  });

  it("asks instead of guessing which building is the sanctuary", () => {
    const result = interpretMission("Preserve the sanctuary.", { structures: TWO_STRUCTURES });
    expect(result.proposals).toHaveLength(0);
    expect(result.needsClarification).toHaveLength(1);
    expect(result.needsClarification[0].reason).toContain("will not choose");
  });

  it("maps an unambiguous single structure for preservation", () => {
    const result = interpretMission("Preserve the sanctuary.", { structures: ONE_STRUCTURE });
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].normalized).toEqual({
      type: "preserve-structure",
      structureId: "884304900:main",
    });
  });

  it("surfaces contradictory ownership language as a conflict with no proposal", () => {
    const result = interpretMission(
      "We must retain ownership, but selling the property is okay.",
      { structures: ONE_STRUCTURE },
    );
    expect(result.conflicts).toHaveLength(1);
    expect(result.proposals.filter((p) => p.normalized.type === "retain-ownership")).toHaveLength(0);
  });

  it("marks unsupported mission goals honestly instead of typing them", () => {
    for (const sentence of [
      "Prioritize affordable housing.",
      "We need long-term income from the property.",
    ]) {
      const result = interpretMission(sentence, { structures: [] });
      expect(result.proposals, sentence).toHaveLength(0);
      expect(result.unsupported.length + result.needsClarification.length, sentence).toBeGreaterThan(0);
    }
  });

  it("PANTRY: never preserves an entire building for an interior ministry area", () => {
    // One generic church structure exists — a pantry is still an interior
    // area, not that whole building. Ask, don't fabricate.
    const result = interpretMission("Preserve the food pantry.", { structures: ONE_STRUCTURE });
    expect(result.proposals).toHaveLength(0);
    expect(result.needsClarification).toHaveLength(1);
    expect(result.needsClarification[0].reason).toContain("interior area");
  });

  it("PANTRY: a resolved structure genuinely named for the pantry maps to it", () => {
    const result = interpretMission(
      "Preserve the food pantry.",
      { structures: [{ structureId: "gis:structure:999", name: "FOOD PANTRY ANNEX" }] },
    );
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].normalized).toEqual({
      type: "preserve-structure",
      structureId: "gis:structure:999",
    });
  });

  it("SANCTUARY: one unambiguous church structure still maps deliberately (canonical demo)", () => {
    const result = interpretMission("Preserve the sanctuary.", { structures: ONE_STRUCTURE });
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].normalized.type).toBe("preserve-structure");
  });

  it("never throws on recognized-but-invalid numbers — they become clarifications", () => {
    const cases: Array<[string, RegExp]> = [
      ["Keep at least 0 Sunday parking spaces.", /whole space/],
      ["At most 0 stories.", /whole number, at least 1/],
      ["No building taller than 0 feet.", /greater than 0 ft/],
      ["Keep at least -5 Sunday parking spaces.", /positive number of spaces/],
      ["Keep at least 1.5 Sunday parking spaces.", /whole space/],
      ["Keep it to at most 2.5 stories.", /whole number, at least 1/],
      ["No building taller than -20 feet.", /positive number of feet/],
    ];
    for (const [sentence, message] of cases) {
      const result = interpretMission(sentence, { structures: ONE_STRUCTURE });
      expect(result.proposals, sentence).toHaveLength(0);
      expect(result.needsClarification, sentence).toHaveLength(1);
      expect(result.needsClarification[0].reason, sentence).toMatch(message);
    }
  });

  it("keeps extreme-but-positive quantities valid with an untested-feasibility note", () => {
    const result = interpretMission("Keep at least 5000 Sunday parking spaces.", {
      structures: ONE_STRUCTURE,
    });
    expect(result.proposals).toHaveLength(1);
    const normalized = result.proposals[0].normalized;
    if (normalized.type !== "min-parking") throw new Error("expected min-parking");
    expect(normalized.spaces.value).toBe(5000);
    expect(result.proposals[0].feasibilityNote).toContain("feasibility has not been tested");
  });

  it("never labels extreme requests impossible", () => {
    const result = interpretMission("Keep at least 5000 Sunday parking spaces.", {
      structures: ONE_STRUCTURE,
    });
    const allText = JSON.stringify(result);
    expect(allText).not.toMatch(/impossible/i);
  });
});

describe("mission parser — determinism", () => {
  it("identical input and context produce identical results", () => {
    const input =
      "Keep the sanctuary. Keep at least 110 Sunday parking spaces. We don't want to sell the land.";
    expect(interpretMission(input, { structures: ONE_STRUCTURE })).toEqual(
      interpretMission(input, { structures: ONE_STRUCTURE }),
    );
  });
});
