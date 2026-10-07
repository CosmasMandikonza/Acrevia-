import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { benchmarkExtractionAdapter } from "../../src/adapters/regulatory/benchmark-extractor";
import { loadBenchmarkEvidence } from "../../src/adapters/regulatory/benchmark-evidence";

/**
 * GOLD PARITY (issue #5): the deterministic extractor reads the actual raw
 * captured evidence (never rules.expected.json) and its CandidateRule output
 * must match the curated oracle. The oracle is consumed HERE, in tests, as
 * the expected side of the comparison — the benchmark is not circular.
 */

const FIXTURE_DIR = join(import.meta.dirname, "../../docs/benchmarks/calvary-memorial-philadelphia");
const PARCEL = "phl:parcel:778273000";

const oracle = JSON.parse(
  readFileSync(join(FIXTURE_DIR, "rules.expected.json"), "utf-8"),
) as {
  rules: Array<{
    id: string;
    category: string;
    value: number | string | null;
    unit: string | null;
    sourceRef: string;
    status: string;
  }>;
};

async function extractBenchmark() {
  const input = loadBenchmarkEvidence({
    fixtureDir: FIXTURE_DIR,
    subject: { subjectNodeId: PARCEL, jurisdictionKey: "philadelphia-pa", district: "RM-1" },
  });
  return benchmarkExtractionAdapter.extract(input);
}

describe("raw evidence -> CandidateRule (gold parity)", () => {
  it(
    "covers every oracle rule with a matching candidate (predicate, value, unit, source)",
    async () => {
      const { candidates } = await extractBenchmark();

      // Oracle rule -> expected candidate predicate mapping.
      const expectation: Array<{ id: string; predicate: string; sourceRef: string; isNumeric: boolean; value: number; unit?: string }> = [];
      for (const rule of oracle.rules) {
        expectation.push({
          id: rule.id,
          predicate: predicateForOracle(rule),
          sourceRef: rule.sourceRef,
          isNumeric: typeof rule.value === "number",
          value: typeof rule.value === "number" ? rule.value : Number.NaN,
          unit: rule.unit ?? undefined,
        });
      }

      for (const expected of expectation) {
        const matches = candidates.filter((c) => c.predicate === expected.predicate && c.sourceRef === expected.sourceRef);
        expect(
          matches.length,
          `oracle rule ${expected.id} (${expected.predicate} @ ${expected.sourceRef})`,
        ).toBeGreaterThan(0);
        if (expected.isNumeric) {
          const numeric = matches.find((c) => c.proposedValue.kind === "quantity");
          expect(numeric, `${expected.id} numeric value`).toBeDefined();
          if (numeric?.proposedValue.kind === "quantity") {
            expect(numeric.proposedValue.value).toBe(expected.value);
            if (expected.unit) {
              expect(numeric.proposedValue.unit).toBe(domainUnitFor(expected.unit));
            }
          }
        }
      }
    },
  );

  it("FAR stays a deliberate UNKNOWN — never 0, never not-applicable", async () => {
    const { candidates } = await extractBenchmark();
    const far = candidates.find((c) => c.predicate === "far");
    expect(far).toBeDefined();
    expect(far?.proposedValue.kind).toBe("unknown");
  });

  it("extraction is deterministic — identical input, identical output", async () => {
    const a = await extractBenchmark();
    const b = await extractBenchmark();
    expect(a.candidates.map((c) => c.candidateId)).toEqual(b.candidates.map((c) => c.candidateId));
    expect(a).toEqual(b);
  });

  it("every candidate independently carries citation + quote + locator + method", async () => {
    const { candidates } = await extractBenchmark();
    for (const candidate of candidates) {
      expect(candidate.sourceArtifactId).toMatch(/^phl:src:S\d+@v1$/);
      expect(candidate.verbatimSupportingText.length).toBeGreaterThan(0);
      expect(candidate.extractionMethod.length).toBeGreaterThan(0);
      expect(candidate.retrievedAt).toMatch(/^\d{4}-/);
    }
  });
});

/** Oracle units are descriptive ("percent_of_lot_area"); the domain Unit is
 *  the typed set. Compare on the domain unit the oracle's describes. */
function domainUnitFor(oracleUnit: string): string {
  if (oracleUnit.startsWith("percent")) return "percent";
  if (oracleUnit.startsWith("sq_ft")) return "sq_ft";
  if (oracleUnit.startsWith("spaces")) return "spaces";
  return oracleUnit;
}

function predicateForOracle(rule: { id: string; category: string }): string {
  switch (rule.category) {
    case "jurisdiction":
    case "zoning-district":
      return "zoning-district";
    case "use-permission":
      return "use-permission";
    case "lot-width":
      return "lot-width";
    case "lot-area":
      return "lot-area";
    case "density":
      return "density-formula";
    case "occupied-area":
      return "occupied-area";
    case "setback-front":
      return "setback-front";
    case "setback-side":
      return "setback-side";
    case "setback-rear":
      return "setback-rear";
    case "height":
      return "max-height";
    case "far":
      return "far";
    case "parking":
      return "parking-requirement";
    case "overlay":
      return "overlay-restriction";
    case "bonus":
      return "density-bonus";
    case "governance":
      return "rco-coverage";
    case "site-condition":
      return sitePredicateFor(rule.id);
    default:
      return rule.category;
  }
}

function sitePredicateFor(ruleId: string): string {
  switch (ruleId) {
    case "phl-site-building":
      return "building-footprint-area";
    case "phl-site-flood":
      return "site-flood";
    case "phl-site-historic-screen":
      return "site-historic-screen";
    case "phl-site-parcel-area":
      return "parcel-area";
    default:
      return "site-condition";
  }
}
