import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { AuthorityLevel } from "../../domain/enums";
import type {
  RawEvidenceDocument,
  RegulatoryExtractionInput,
  SourceMetadata,
} from "../../application/regulatory/extraction";

/**
 * Loads the canonical Calvary benchmark's RAW captured evidence and source
 * manifest from disk into a RegulatoryExtractionInput. This is the only path
 * by which benchmark evidence reaches the compiler — rules.expected.json is
 * a test oracle and is never read here (no circularity).
 */

const Manifest = z.object({
  sources: z.array(
    z.object({
      id: z.string(),
      authorityLevel: AuthorityLevel,
      title: z.string(),
      publisher: z.string().optional(),
      url: z.string().optional(),
      retrievedAt: z.string().optional(),
    }),
  ),
});

export function loadBenchmarkEvidence(input: {
  fixtureDir: string;
  subject: RegulatoryExtractionInput["subject"];
}): RegulatoryExtractionInput {
  const manifest = Manifest.parse(
    JSON.parse(readFileSync(join(input.fixtureDir, "sources.manifest.json"), "utf-8")),
  );
  const sources: SourceMetadata[] = manifest.sources.map((source) => ({
    sourceRef: source.id,
    title: source.title,
    publisher: source.publisher ?? "City of Philadelphia",
    canonicalUrl: source.url ?? "about:blank",
    authority: source.authorityLevel,
    retrievedAt: source.retrievedAt ?? "1970-01-01T00:00:00Z",
  }));

  const rawDir = join(input.fixtureDir, "raw");
  const documents: RawEvidenceDocument[] = [];
  const addDocument = (dir: string, name: string) => {
    const path = join(dir, name);
    if (name.endsWith(".md")) {
      documents.push({
        documentId: name,
        sourceRef: sourceRefForDocument(name),
        kind: "code-text",
        text: readFileSync(path, "utf-8"),
      });
    } else if (name.endsWith(".json") && !name.startsWith("_")) {
      documents.push({
        documentId: name,
        sourceRef: sourceRefForDocument(name),
        kind: "gis-json",
        json: JSON.parse(readFileSync(path, "utf-8")),
      });
    }
  };
  for (const name of readdirSync(rawDir).sort()) {
    if (name === "_capture-metadata.json" || name === "gis") continue;
    addDocument(rawDir, name);
  }
  // The live-capture tier under raw/gis/ (issue #4 evidence) also feeds the
  // compiler — e.g. the WGS84 footprint GeoJSON with its recorded square_ft.
  const gisDir = join(rawDir, "gis");
  for (const name of readdirSync(gisDir).sort()) {
    addDocument(gisDir, name);
  }

  return { documents, sources, subject: input.subject };
}

/** Raw-capture file -> manifest sourceRef (documented, deterministic). */
export function sourceRefForDocument(documentId: string): string {
  switch (documentId) {
    case "quick-guide-rm1.md":
      return "S5";
    case "code-14-548-excerpt.md":
      return "S6";
    case "code-14-802-excerpt.md":
      return "S7";
    case "opa-record.json":
      return "S1";
    case "pwd-parcel.json":
      return "S2";
    case "zoning-base.json":
      return "S3";
    case "zoning-overlays.json":
      return "S4";
    case "building-footprints.json":
      return "S8";
    case "flood.json":
      return "S9";
    case "historic.json":
      return "S10";
    case "landmark.json":
      return "S10";
    case "rco.json":
      return "S11";
    case "footprints-parcel-494018.json":
      return "S8";
    default:
      return "S0";
  }
}
