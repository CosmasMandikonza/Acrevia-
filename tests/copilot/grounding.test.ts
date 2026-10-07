import { describe, expect, it } from "vitest";
import {
  allowedNumbers,
  groundingViolations,
  numericTokens,
} from "../../src/application/copilot/grounding";

describe("numeric grounding guard (issue #10 — model cannot invent authoritative numbers)", () => {
  it("collects tokens from text and JSON, normalizing commas and decimals", () => {
    expect(
      [...numericTokens("76,418 ft² and 123 homes at 75%")].sort(),
    ).toEqual(["123", "75", "76418"].sort());
    expect(
      allowedNumbers(['{"homes":123,"heightFt":38}'], "why not 124?"),
    ).toEqual(new Set(["123", "38", "124"]));
  });

  it("passes replies whose consequential numbers exist in tool output or the user's words", () => {
    const allowed = allowedNumbers(
      ['{"modeledUpperBoundHomes":123,"binding":[{"currentLimit":110}]}'],
      "Why can't 124 homes fit?",
    );
    expect(
      groundingViolations(
        "The solver refuses 124 homes: the modeled upper bound is 123 homes, and your Sunday parking minimum of 110 is mission-locked. There are 3 verified alternatives.",
        allowed,
      ),
    ).toEqual([]);
  });

  it("flags fabricated numbers absent from tool state", () => {
    const allowed = allowedNumbers(['{"homes":123}'], "why not 124 homes");
    expect(
      groundingViolations(
        "Actually 87 homes could fit with a variance.",
        allowed,
      ),
    ).toEqual(["87"]);
  });

  it("exempts small structural integers but not consequential metrics", () => {
    const allowed = new Set<string>();
    expect(
      groundingViolations("There are 2 options; see items 1 and 2.", allowed),
    ).toEqual([]);
    expect(groundingViolations("45 ft is the height limit.", allowed)).toEqual([
      "45",
    ]);
    expect(groundingViolations("90 spaces would remain.", allowed)).toEqual([
      "90",
    ]);
  });

  it("de-duplicates repeated violations and keeps original token spelling", () => {
    const allowed = new Set<string>();
    expect(
      groundingViolations("87 homes. Yes, 87. Maybe 87.", allowed),
    ).toEqual(["87"]);
  });
});
