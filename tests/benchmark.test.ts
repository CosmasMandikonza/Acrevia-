import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const benchmarksRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs",
  "benchmarks",
);

const STATUSES = [
  "VERIFIED",
  "SOURCE_CONFIRMED",
  "ASSUMPTION",
  "CONFLICT",
  "UNKNOWN",
  "EXPERT_REQUIRED",
  "STALE",
] as const;

const AUTHORITY_LEVELS = [
  "ADOPTED_CODE",
  "OFFICIAL_GIS",
  "OFFICIAL_CITY_TOOL",
  "OFFICIAL_CITY_REFERENCE",
  "PROPERTY_SELF_REPORTED",
  "SECONDARY",
] as const;

/** Categories every fixture must cover via a rule or an open question. */
const REQUIRED_CATEGORIES = [
  "zoning-district",
  "use-permission",
  "height",
  "occupied-area",
  "density",
  "parking",
  "overlay",
  "setback-front",
];

const CANONICAL = "calvary-memorial-philadelphia";

type Rule = {
  id: string;
  category: string;
  statement: string;
  value: number | string | null;
  unit: string | null;
  sourceRef: string;
  codeSection: string | null;
  authorityLevel: string;
  status: string;
  legalFinality: string;
  retrievedAt: string;
  verbatimQuote?: string;
  notes?: string;
};

type ManifestSource = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  authorityLevel: string;
  retrievedAt: string;
  purpose: string;
  rawEvidence?: string;
  notes?: string;
};

type OpenQuestion = {
  id: string;
  category: string;
  kind: "UNKNOWN" | "EXPERT_REQUIRED";
  question: string;
  whyItMatters: string;
};

type GeoJSONFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};

function propertyDirs(): string[] {
  return readdirSync(benchmarksRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) =>
      [
        "sources.manifest.json",
        "parcel.geojson",
        "rules.expected.json",
        "open-questions.json",
      ].every((file) => existsSync(join(benchmarksRoot, name, file))),
    );
}

function loadJson(dir: string, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(benchmarksRoot, dir, file), "utf-8"));
}

function ringPoints(geometry: GeoJSONFeature["geometry"]): [number, number][] {
  if (geometry.type === "Polygon") {
    return (geometry.coordinates as [number, number][][])[0];
  }
  if (geometry.type === "MultiPolygon") {
    const polys = geometry.coordinates as [number, number][][][];
    if (polys.length !== 1) throw new Error("expected exactly one polygon");
    return polys[0][0];
  }
  throw new Error(`unsupported geometry type ${geometry.type}`);
}

/** Equirectangular area cross-check, the same method documented in fixture properties. */
function equirectAreaSqFt(ring: [number, number][]): number {
  const lat = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
  const mLat = 111320;
  const mLon = 111320 * Math.cos((lat * Math.PI) / 180);
  let s = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = [ring[i][0] * mLon, ring[i][1] * mLat];
    const [x2, y2] = [ring[i + 1][0] * mLon, ring[i + 1][1] * mLat];
    s += x1 * y2 - x2 * y1;
  }
  return (Math.abs(s) / 2) * 10.7639;
}

function isIso8601Utc(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

describe("benchmark pack structure", () => {
  it("contains the canonical property and at least two secondary properties", () => {
    const dirs = propertyDirs();
    expect(dirs).toContain(CANONICAL);
    expect(dirs.filter((d) => d !== CANONICAL).length).toBeGreaterThanOrEqual(2);
  });
});

propertyDirs().forEach((dir) => {
  const isCanonical = dir === CANONICAL;

  describe(`fixture: ${dir}`, () => {
    const manifest = loadJson(dir, "sources.manifest.json");
    const sources = manifest.sources as ManifestSource[];
    const rulesDoc = loadJson(dir, "rules.expected.json");
    const rules = rulesDoc.rules as Rule[];
    const questionsDoc = loadJson(dir, "open-questions.json");
    const questions = questionsDoc.questions as OpenQuestion[];
    const parcel = loadJson(dir, "parcel.geojson") as unknown as GeoJSONFeature;
    const sourceIds = new Set(sources.map((s) => s.id));

    it("manifest: sources are unique, https, timestamped, and use valid authority levels", () => {
      expect(new Set(sources.map((s) => s.id)).size).toBe(sources.length);
      sources.forEach((source) => {
        expect(source.title.length).toBeGreaterThan(0);
        expect(source.publisher.length).toBeGreaterThan(0);
        expect(source.url.startsWith("https://")).toBe(true);
        expect(AUTHORITY_LEVELS).toContain(source.authorityLevel);
        expect(isIso8601Utc(source.retrievedAt)).toBe(true);
      });
    });

    it("parcel: valid closed GeoJSON polygon with provenance and consistent area", () => {
      expect(parcel.type).toBe("Feature");
      const ring = ringPoints(parcel.geometry);
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      ring.forEach(([lon, lat]) => {
        expect(lon).toBeGreaterThan(-180);
        expect(lon).toBeLessThan(180);
        expect(lat).toBeGreaterThan(-85);
        expect(lat).toBeLessThan(85);
      });
      const props = parcel.properties;
      expect(typeof props.sourceRef).toBe("string");
      expect(sourceIds.has(props.sourceRef as string)).toBe(true);
      const recorded = props.recordedAreaSqFt as number;
      expect(recorded).toBeGreaterThan(0);
      const computed = equirectAreaSqFt(ring);
      // 10% tolerance covers projection and polygon-simplification differences.
      expect(Math.abs(computed - recorded) / recorded).toBeLessThan(0.1);
      expect(isIso8601Utc(props.retrievedAt)).toBe(true);
    });

    it("rules: ids unique, fields valid, statuses and authorities in vocabulary", () => {
      expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
      rules.forEach((rule) => {
        expect(rule.statement.length).toBeGreaterThan(10);
        expect(STATUSES).toContain(rule.status);
        expect(AUTHORITY_LEVELS).toContain(rule.authorityLevel);
        expect(rule.legalFinality).toBe("EXPERT_REVIEW_REQUIRED");
        expect(isIso8601Utc(rule.retrievedAt)).toBe(true);
        expect(sourceIds.has(rule.sourceRef)).toBe(true);
      });
    });

    it("rules: nothing is VERIFIED or SOURCE_CONFIRMED without a source, quote, and section", () => {
      rules
        .filter((rule) => rule.status === "VERIFIED" || rule.status === "SOURCE_CONFIRMED")
        .forEach((rule) => {
          expect((rule.verbatimQuote ?? "").length).toBeGreaterThan(15);
        });
      rules
        .filter((rule) => rule.status === "VERIFIED")
        .forEach((rule) => {
          expect((rule.codeSection ?? "").length).toBeGreaterThan(0);
        });
    });

    it("rules: adopted-code capture documented (canonical requires VERIFIED rules)", () => {
      if (isCanonical) {
        expect(rules.filter((rule) => rule.status === "VERIFIED").length).toBeGreaterThanOrEqual(3);
      } else {
        // Secondaries without adopted-text capture must say so: every fixture documents
        // its authority/currentness boundary as a jurisdiction open question.
        expect(
          questions.some((question) => question.category === "jurisdiction"),
          "missing authority/currentness open question",
        ).toBe(true);
      }
    });

    it("coverage: every required zoning dimension is a rule or an open question", () => {
      const covered = new Set([
        ...rules.map((rule) => rule.category),
        ...questions.map((question) => question.category),
      ]);
      REQUIRED_CATEGORIES.forEach((category) => {
        expect(covered, `missing category: ${category}`).toContain(category);
      });
    });

    it("open questions: present, well-formed, and non-empty", () => {
      expect(questions.length).toBeGreaterThanOrEqual(3);
      const kinds = new Set(questions.map((q) => q.kind));
      expect(kinds.has("UNKNOWN") || kinds.has("EXPERT_REQUIRED")).toBe(true);
      questions.forEach((question) => {
        expect(question.question.length).toBeGreaterThan(15);
        expect(question.whyItMatters.length).toBeGreaterThan(10);
      });
    });

    if (isCanonical) {
      it("canonical: raw evidence directory exists and is populated", () => {
        const rawDir = join(benchmarksRoot, dir, "raw");
        expect(existsSync(rawDir)).toBe(true);
        expect(readdirSync(rawDir).length).toBeGreaterThanOrEqual(8);
      });

      it("canonical: unresolved items exist (no artificially clean benchmark)", () => {
        const unresolvedRules = rules.filter(
          (rule) => rule.status === "UNKNOWN" || rule.status === "EXPERT_REQUIRED",
        );
        expect(
          unresolvedRules.length + questions.length,
          "a benchmark with zero unknowns would be suspicious",
        ).toBeGreaterThanOrEqual(10);
      });

      it("canonical: adopted-code parking rule exists (feasibility-critical capture)", () => {
        const parking = rules.filter((rule) => rule.category === "parking");
        expect(parking.some((rule) => rule.status === "VERIFIED")).toBe(true);
      });
    }
  });
});
