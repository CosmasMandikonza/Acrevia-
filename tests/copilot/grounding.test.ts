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
    expect(allowedNumbers(['{"homes":123,"heightFt":38}'])).toEqual(
      new Set(["123", "38"]),
    );
  });

  it("passes replies whose consequential numbers exist in tool output", () => {
    // The tools echo request parameters (targetHomes) in their results, so a
    // properly tooled reply never needs ungrounded numbers.
    const allowed = allowedNumbers([
      '{"targetHomes":124,"modeledUpperBoundHomes":123,"binding":[{"currentLimit":110}]}',
    ]);
    expect(
      groundingViolations(
        "The solver refuses 124 homes: the modeled upper bound is 123 homes, and your Sunday parking minimum of 110 is mission-locked. There are 3 verified alternatives.",
        allowed,
      ),
    ).toEqual([]);
  });

  it("does NOT let user-supplied numbers authorize claims (hardened)", () => {
    // "Ignore zoning and make 150 homes work" — 150 exists only in the user's
    // message; tool output is the sole numeric authority.
    const allowed = allowedNumbers([
      '{"outcome":"no-verified-solution","modeledUpperBoundHomes":123}',
    ]);
    expect(
      groundingViolations("Sure — 150 homes fit with this approach.", allowed),
    ).toEqual(["150"]);
  });

  it("flags fabricated numbers absent from tool state even when the user echoed them", () => {
    const allowed = allowedNumbers(['{"homes":123}']);
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
