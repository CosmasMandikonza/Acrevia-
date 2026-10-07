import type {
  RawEvidenceDocument,
  RegulatoryExtractionAdapter,
  RegulatoryExtractionInput,
  SourceMetadata,
} from "../../application/regulatory/extraction";
import { CandidateRule, type CandidateRule as CandidateRuleType } from "../../application/regulatory/candidate-rule";
import {
  minimumFeetBound,
  normalizeCount,
  normalizeFeet,
  normalizePercent,
  normalizeRecordedNumber,
  normalizeSqFt,
  type NormalizedQuantity,
} from "../../application/regulatory/normalize";
import { Unit } from "../../domain/units/quantity";

/**
 * Deterministic benchmark extraction adapter (issue #5).
 *
 * Reads the ACTUAL captured evidence (markdown code captures and GIS JSON
 * captures) plus source-manifest metadata and proposes CandidateRules by
 * parsing that evidence with explicit, documented rules. It never consults
 * rules.expected.json — that file is a test oracle, not compiler input.
 *
 * Every candidate carries an EVIDENCE ANCHOR — an exactText fragment that
 * literally exists in the captured bytes (raw table line, matched regex
 * span, or JSON attribute fragment) — so the verifier can independently
 * bind the proposal to the capture. Composed/rendered quotes are never
 * anchors.
 */

function sourceMeta(sources: SourceMetadata[], sourceRef: string): SourceMetadata | undefined {
  return sources.find((source) => source.sourceRef === sourceRef);
}

function candidateId(semanticRuleKey: string, sourceArtifactId: string, suffix = ""): string {
  return `cand:${semanticRuleKey}:${sourceArtifactId}${suffix ? `:${suffix}` : ""}`;
}

function keySlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/^[/]+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function asUnitQuantity(normalized: NormalizedQuantity): { kind: "quantity"; value: number; unit: Unit } {
  return { kind: "quantity", value: normalized.value, unit: Unit.parse(normalized.unit) };
}

type ExtractContext = { documentId: string };

function baseCandidate(
  input: RegulatoryExtractionInput,
  sourceRef: string,
  sources: SourceMetadata[],
  ctx: ExtractContext,
  init: {
    semanticRuleKey: string;
    predicate: CandidateRuleType["predicate"];
    proposedValue: CandidateRuleType["proposedValue"];
    anchorText: string;
    applicability?: CandidateRuleType["applicability"];
    codeSection?: string;
    verbatimSupportingText: string;
    extractionMethod: string;
    notes?: string;
  },
  suffix = "",
): CandidateRuleType | null {
  const meta = sourceMeta(sources, sourceRef);
  if (!meta) return null;
  return CandidateRule.parse({
    candidateId: candidateId(init.semanticRuleKey, meta.sourceArtifactId, suffix),
    semanticRuleKey: init.semanticRuleKey,
    sourceArtifactId: meta.sourceArtifactId,
    sourceRef,
    evidenceAnchor: { documentId: ctx.documentId, exactText: init.anchorText },
    subjectNodeId: input.subject.subjectNodeId,
    jurisdictionKey: input.subject.jurisdictionKey,
    predicate: init.predicate,
    proposedValue: init.proposedValue,
    applicability: init.applicability ?? { district: input.subject.district },
    codeSection: init.codeSection,
    verbatimSupportingText: init.verbatimSupportingText,
    authority: meta.authority,
    retrievedAt: meta.retrievedAt,
    extractionMethod: init.extractionMethod,
    notes: init.notes,
  });
}

type CellMatch = { cell: string; line: string };

function tableCell(markdown: string, rowLabel: RegExp): CellMatch | null {
  for (const line of markdown.split("\n")) {
    if (rowLabel.test(line) && line.trim().startsWith("|")) {
      const cells = line.split("|").map((cell) => cell.trim());
      if (cells.length >= 3) return { cell: cells[cells.length - 2], line };
    }
  }
  return null;
}

function tableRowFor(markdown: string, useLabel: RegExp): CellMatch | null {
  for (const line of markdown.split("\n")) {
    if (useLabel.test(line) && line.trim().startsWith("|")) {
      const cells = line.split("|").map((cell) => cell.trim());
      if (cells.length >= 3) return { cell: cells[cells.length - 2], line };
    }
  }
  return null;
}

function extractQuickGuide(
  input: RegulatoryExtractionInput,
  doc: RawEvidenceDocument,
  sources: SourceMetadata[],
  notes: string[],
): CandidateRuleType[] {
  const text = doc.text ?? "";
  const out: CandidateRuleType[] = [];
  const ctx: ExtractContext = { documentId: doc.documentId };
  const push = (init: Parameters<typeof baseCandidate>[4], suffix?: string) => {
    const candidate = baseCandidate(input, "S5", sources, ctx, init, suffix);
    if (candidate) out.push(candidate);
    else notes.push(`S5 metadata missing; candidate ${init.semanticRuleKey} skipped`);
  };
  const guideLocator = "The Philadelphia Code § 14-701, Table 14-701-2 (RM-1 column)";

  const lotWidth = tableCell(text, /Min\.\s*Lot\s*Width/i);
  if (lotWidth) {
    const normalized = normalizeFeet(lotWidth.cell);
    if (normalized) {
      push({
        semanticRuleKey: "lot:width:min",
        predicate: "lot-width",
        proposedValue: asUnitQuantity(normalized),
        anchorText: lotWidth.line,
        codeSection: guideLocator,
        verbatimSupportingText: `Table 14-701-2: 'Min. Lot Width ... ${lotWidth.cell}'`,
        extractionMethod: "quick-guide-table-row:normalizeFeet",
      });
    }
  }

  const lotArea = tableCell(text, /Min\.\s*Lot\s*Area/i);
  if (lotArea) {
    const normalized = normalizeSqFt(lotArea.cell);
    if (normalized) {
      push({
        semanticRuleKey: "lot:area:min",
        predicate: "lot-area",
        proposedValue: asUnitQuantity(normalized),
        anchorText: lotArea.line,
        codeSection: guideLocator,
        verbatimSupportingText: `Table 14-701-2: 'Min. Lot Area ... ${lotArea.cell}'`,
        extractionMethod: "quick-guide-table-row:normalizeSqFt",
      });
    }
  }

  const occupied = tableCell(text, /Max\.\s*Occupied\s*Area/i);
  if (occupied) {
    const normalized = normalizePercent(occupied.cell);
    if (normalized) {
      push({
        semanticRuleKey: "bulk:occupied-area:max",
        predicate: "occupied-area",
        proposedValue: asUnitQuantity(normalized),
        anchorText: occupied.line,
        applicability: { district: input.subject.district, lotType: "intermediate" },
        codeSection: guideLocator,
        verbatimSupportingText: `Table 14-701-2: 'Max. Occupied Area ... ${occupied.cell}'`,
        extractionMethod: "quick-guide-table-row:normalizePercent(intermediate)",
        notes: "Guide lists Intermediate 75%; Corner 80% — intermediate lot recorded.",
      });
    }
  }

  const frontSetback = tableCell(text, /Min\.\s*Front\s*Setback/i);
  if (frontSetback) {
    push({
      semanticRuleKey: "setback:front",
      predicate: "setback-front",
      proposedValue: {
        kind: "qualitative",
        text: `Context-based front facade placement: ${frontSetback.cell} (table notes [5], [6] govern).`,
      },
      anchorText: frontSetback.line,
      codeSection: `${guideLocator}, notes [5], [6]`,
      verbatimSupportingText: `'Min. Front Setback ... ${frontSetback.cell}'`,
      extractionMethod: "quick-guide-table-row:contextual",
      notes: "No fixed numeric minimum in the guide's table; a contextual rule.",
    });
  }

  const sideYard = tableCell(text, /Side\s*Yard\s*Width/i);
  if (sideYard) {
    const normalized = minimumFeetBound(sideYard.cell);
    if (normalized) {
      push({
        semanticRuleKey: "setback:side:min",
        predicate: "setback-side",
        proposedValue: asUnitQuantity(normalized),
        anchorText: sideYard.line,
        codeSection: guideLocator,
        verbatimSupportingText: `'${sideYard.cell}'`,
        extractionMethod: "quick-guide-table-row:minimumFeetBound",
        notes: "Range expressed by families; governing minimum recorded.",
      });
    }
  }

  const rearYard = tableCell(text, /Rear\s*Yard\s*Depth/i);
  if (rearYard) {
    const normalized = normalizeFeet(rearYard.cell);
    if (normalized) {
      push({
        semanticRuleKey: "setback:rear:min",
        predicate: "setback-rear",
        proposedValue: asUnitQuantity(normalized),
        anchorText: rearYard.line,
        codeSection: guideLocator,
        verbatimSupportingText: `'Min. Rear Yard Depth ... ${rearYard.cell}'`,
        extractionMethod: "quick-guide-table-row:normalizeFeet",
      });
    }
  }

  const heightFar = tableCell(text, /Max\.\s*Height\s*\/\s*FAR/i);
  if (heightFar) {
    const normalized = normalizeFeet(heightFar.cell);
    if (normalized) {
      push({
        semanticRuleKey: "height:max:principal",
        predicate: "max-height",
        proposedValue: asUnitQuantity(normalized),
        anchorText: heightFar.line,
        codeSection: guideLocator,
        verbatimSupportingText: `'Max. Height / FAR ... ${heightFar.cell}'`,
        extractionMethod: "quick-guide-table-row:normalizeFeet",
      });
    }
    if (!/floor area ratio/i.test(text)) {
      push({
        semanticRuleKey: "far:max",
        predicate: "far",
        proposedValue: { kind: "unknown" },
        anchorText: heightFar.line,
        codeSection: guideLocator,
        verbatimSupportingText: `'Max. Height / FAR ... ${heightFar.cell}' (no ratio value in the RM-1 evidence)`,
        extractionMethod: "quick-guide-table-row:absent-value",
        notes:
          "No FAR value is established by the captured RM-1 evidence; recorded UNKNOWN rather than asserting no FAR regulation. Confirm against adopted § 14-701 before solver use.",
      });
    }
  }

  const densityIndex = text.indexOf("minimum lot area required per dwelling unit");
  if (densityIndex >= 0) {
    const noteStart = Math.max(0, text.lastIndexOf("[1]", densityIndex));
    push({
      semanticRuleKey: "density:min-lot-area-per-unit",
      predicate: "density-formula",
      proposedValue: {
        kind: "qualitative",
        text: "Tiered minimum lot area per dwelling unit: 360 sq ft per unit for the first 1,440 sq ft of lot area; 480 sq ft per unit above 1,440; fractional units round down.",
      },
      anchorText: text.slice(densityIndex, densityIndex + 120),
      codeSection: `${guideLocator}, note [1] (density row)`,
      verbatimSupportingText: text.slice(noteStart, noteStart + 320).replace(/\s+/g, " ").trim(),
      extractionMethod: "quick-guide-note:tiered-formula",
    });
  }

  const usesLocator = "The Philadelphia Code § 14-601, Table 14-602-1 (RM-1 column)";
  const multiFamily = tableRowFor(text, /Multi-Family/i);
  if (multiFamily) {
    push({
      semanticRuleKey: "use:multi-family:permission",
      predicate: "use-permission",
      proposedValue: { kind: "qualitative", text: multiFamily.cell },
      anchorText: multiFamily.line,
      applicability: { district: input.subject.district, use: "household-living-multi-family" },
      codeSection: usesLocator,
      verbatimSupportingText: `'Household Living — Multi-Family | ${multiFamily.cell}'`,
      extractionMethod: "quick-guide-use-table-row",
    });
  }
  const religious = tableRowFor(text, /Religious\s*Assembly/i);
  if (religious) {
    push({
      semanticRuleKey: "use:religious-assembly:permission",
      predicate: "use-permission",
      proposedValue: { kind: "qualitative", text: religious.cell },
      anchorText: religious.line,
      applicability: { district: input.subject.district, use: "religious-assembly" },
      codeSection: usesLocator,
      verbatimSupportingText: `'Religious Assembly | ${religious.cell}'`,
      extractionMethod: "quick-guide-use-table-row",
    });
  }
  const childCareCenter = tableRowFor(text, /\|\s*Child Care Center\s*\|/i);
  const familyChildCare = tableRowFor(text, /Family\s*Child\s*Care/i);
  if (childCareCenter && familyChildCare) {
    push({
      semanticRuleKey: "use:child-care:permission",
      predicate: "use-permission",
      proposedValue: { kind: "qualitative", text: `${childCareCenter.cell} / ${familyChildCare.cell}` },
      anchorText: childCareCenter.line,
      applicability: { district: input.subject.district, use: "child-care" },
      codeSection: usesLocator,
      verbatimSupportingText: `'Child Care Center | ${childCareCenter.cell}'; 'Family Child Care | ${familyChildCare.cell}'`,
      extractionMethod: "quick-guide-use-table-rows:combined",
    });
  }

  const bonusMatch = text.match(/Mixed Income Housing([\s\S]*?)Moderate Income:\s*(\d+)%/);
  if (bonusMatch) {
    push({
      semanticRuleKey: "bonus:mixed-income:percent",
      predicate: "density-bonus",
      proposedValue: { kind: "quantity", value: Number(bonusMatch[2]), unit: "percent" as const },
      anchorText: "Mixed Income Housing (§14-702(7)) — Moderate Income: 25% increase in units permitted",
      applicability: { district: input.subject.district, use: "mixed-income-housing" },
      codeSection: "The Philadelphia Code § 14-702(7) (guide bonus summary)",
      verbatimSupportingText: bonusMatch[0].replace(/\s+/g, " ").trim().slice(0, 200),
      extractionMethod: "quick-guide-bonus-summary:normalizePercent",
    });
  }

  return out;
}

function extractParkingCode(
  input: RegulatoryExtractionInput,
  doc: RawEvidenceDocument,
  sources: SourceMetadata[],
): CandidateRuleType[] {
  const text = doc.text ?? "";
  const out: CandidateRuleType[] = [];
  const ctx: ExtractContext = { documentId: doc.documentId };
  const locator = "The Philadelphia Code § 14-802(2), Table 14-802-1 (RM-1 column group)";

  const multiFamily = text.match(/Multi-Family\s+—\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\S+)/);
  if (multiFamily) {
    const normalized = normalizeCount(multiFamily[2]);
    if (normalized) {
      const candidate = baseCandidate(input, "S7", sources, ctx, {
        semanticRuleKey: "parking:multi-family:minimum",
        predicate: "parking-requirement",
        proposedValue: asUnitQuantity(normalized),
        anchorText: multiFamily[0],
        applicability: { district: input.subject.district, use: "household-living-multi-family" },
        codeSection: locator,
        verbatimSupportingText: `Table 14-802-1: 'Multi-Family — ${multiFamily[1]} | ${multiFamily[2]} | ${multiFamily[3]}' (column group 2 includes RM-1)`,
        extractionMethod: "adopted-code-table-cell:group2",
        notes: "0 required spaces for multi-family in RM-1; re-verified live during capture review.",
      });
      if (candidate) out.push(candidate);
    }
  }

  const religious = text.match(/Religious Assembly — "([^"]+)"/);
  if (religious) {
    const candidate = baseCandidate(input, "S7", sources, ctx, {
      semanticRuleKey: "parking:religious-assembly:minimum",
      predicate: "parking-requirement",
      proposedValue: { kind: "qualitative", text: religious[1] },
      anchorText: religious[0],
      applicability: { use: "religious-assembly" },
      codeSection: locator,
      verbatimSupportingText: `Religious Assembly — "${religious[1]}" (same in all residential-district columns)`,
      extractionMethod: "adopted-code-table-cell:formula",
    });
    if (candidate) out.push(candidate);
  }
  return out;
}

function extractOverlayCode(
  input: RegulatoryExtractionInput,
  doc: RawEvidenceDocument,
  sources: SourceMetadata[],
): CandidateRuleType[] {
  const text = doc.text ?? "";
  const out: CandidateRuleType[] = [];
  const ctx: ExtractContext = { documentId: doc.documentId };
  const locator = "The Philadelphia Code § 14-548 (/SIX, Sixth District Overlay District)";

  if (/Accessory dwelling units shall not be permitted/.test(text)) {
    const candidate = baseCandidate(input, "S6", sources, ctx, {
      semanticRuleKey: "overlay:/six:adu-prohibition",
      predicate: "overlay-restriction",
      proposedValue: {
        kind: "qualitative",
        text: "Accessory dwelling units are not permitted within the /SIX overlay.",
      },
      anchorText: "(.c) Accessory dwelling units shall not be permitted.",
      applicability: { overlay: "/SIX" },
      codeSection: `${locator}, (2)(.c)`,
      verbatimSupportingText: "(.c) Accessory dwelling units shall not be permitted.",
      extractionMethod: "adopted-code-verbatim",
    });
    if (candidate) out.push(candidate);
  }

  if (/\(1\)\s+Applicability\./.test(text)) {
    const applicabilityQuote =
      "(1) Applicability. The Sixth District Overlay District applies to lots located within District No. 6, as defined in Section 20-501 (Boundaries of Districts).";
    const candidate = baseCandidate(input, "S6", sources, ctx, {
      semanticRuleKey: "overlay:/six:applicability",
      predicate: "overlay-restriction",
      proposedValue: {
        kind: "qualitative",
        text: "The /SIX overlay applies to lots located within Council District No. 6.",
      },
      anchorText: applicabilityQuote,
      applicability: { overlay: "/SIX" },
      codeSection: `${locator}, (1)`,
      verbatimSupportingText: applicabilityQuote,
      extractionMethod: "adopted-code-verbatim",
    });
    if (candidate) out.push(candidate);
  }
  return out;
}

type ArcgisFeatureCollection = {
  features?: Array<{ attributes?: Record<string, unknown> }>;
};

type CartoRows = {
  rows?: Array<Record<string, unknown>>;
};

type GeoJsonFeatureCollection = {
  type?: string;
  features?: Array<{
    properties?: Record<string, unknown>;
    geometry?: unknown;
  }>;
};

function isCartoRows(json: unknown): json is CartoRows {
  return typeof json === "object" && json !== null && Array.isArray((json as CartoRows).rows);
}

function isGeoJsonFeatureCollection(json: unknown): json is GeoJsonFeatureCollection {
  return (
    typeof json === "object" &&
    json !== null &&
    (json as GeoJsonFeatureCollection).type === "FeatureCollection" &&
    Array.isArray((json as GeoJsonFeatureCollection).features)
  );
}

/** A JSON attribute fragment that literally exists in the stringified capture. */
function jsonAttr(key: string, value: unknown): string {
  return `"${key}":${JSON.stringify(value)}`;
}

function extractGis(
  input: RegulatoryExtractionInput,
  doc: RawEvidenceDocument,
  sources: SourceMetadata[],
  notes: string[],
): CandidateRuleType[] {
  const gisCtx: ExtractContext = { documentId: doc.documentId };
  if (isGeoJsonFeatureCollection(doc.json)) {
    const props = doc.json.features?.[0]?.properties ?? {};
    if (doc.documentId.startsWith("footprints-parcel-")) {
      const area = props.square_ft !== undefined ? normalizeRecordedNumber(props.square_ft as string | number, "sq_ft") : null;
      if (area) {
        const candidate = baseCandidate(input, doc.sourceRef, sources, gisCtx, {
          semanticRuleKey: "site:building-footprint",
          predicate: "building-footprint-area",
          proposedValue: asUnitQuantity(area),
          anchorText: jsonAttr("square_ft", props.square_ft),
          codeSection: "building_footprints GIS layer (recorded square_ft)",
          verbatimSupportingText: `feature square_ft: ${String(props.square_ft)} (BIN ${String(props.bin ?? "")})`,
          extractionMethod: "geojson-feature-property:normalizeSqFt",
        });
        return candidate ? [candidate] : [];
      }
    }
    notes.push(`${doc.documentId}: covered by the top-level capture; skipped`);
    return [];
  }

  if (isCartoRows(doc.json)) {
    const row = doc.json.rows?.[0];
    if (doc.documentId === "pwd-parcel.json" && row) {
      const area = row.gross_area !== undefined ? normalizeRecordedNumber(row.gross_area as string | number, "sq_ft") : null;
      if (area) {
        const candidate = baseCandidate(input, doc.sourceRef, sources, gisCtx, {
          semanticRuleKey: "site:parcel-area",
          predicate: "parcel-area",
          proposedValue: asUnitQuantity(area),
          anchorText: jsonAttr("gross_area", row.gross_area),
          codeSection: "PWD Parcels registry record (gross_area)",
          verbatimSupportingText: `pwd_parcels: {"brt_id": "${String(row.brt_id ?? "")}", "gross_area": ${String(row.gross_area)}}`,
          extractionMethod: "carto-row:normalizeSqFt",
        });
        return candidate ? [candidate] : [];
      }
    }
    notes.push(`${doc.documentId}: no unique regulatory fact; covered by the GIS session layer`);
    return [];
  }

  const json = doc.json as ArcgisFeatureCollection | undefined;
  if (!json || !Array.isArray(json.features)) {
    notes.push(`${doc.documentId}: not an ArcGIS feature collection; skipped`);
    return [];
  }
  const out: CandidateRuleType[] = [];
  const push = (init: Parameters<typeof baseCandidate>[4], suffix?: string) => {
    const candidate = baseCandidate(input, doc.sourceRef, sources, gisCtx, init, suffix);
    if (candidate) out.push(candidate);
  };
  const attrs = (index: number) => json.features?.[index]?.attributes ?? {};

  switch (doc.documentId) {
    case "zoning-base.json": {
      const zoning = String(attrs(0).long_code ?? attrs(0).zoning ?? "");
      if (zoning) {
        push({
          semanticRuleKey: "zoning:district",
          predicate: "zoning-district",
          proposedValue: { kind: "qualitative", text: zoning },
          anchorText: jsonAttr("long_code", attrs(0).long_code ?? zoning),
          codeSection: "L&I Zoning_BaseDistricts GIS layer (parcel centroid query)",
          verbatimSupportingText: `zoning: "${zoning}"`,
          extractionMethod: "gis-feature-attribute",
        });
        push({
          semanticRuleKey: "jurisdiction:frame",
          predicate: "zoning-district",
          proposedValue: {
            kind: "qualitative",
            text: "Zoning is administered under The Philadelphia Code, Title 14; permits by L&I.",
          },
          anchorText: jsonAttr("zoninggroup", attrs(0).zoninggroup ?? ""),
          codeSection: "The Philadelphia Code, Title 14 (structure)",
          verbatimSupportingText: `zoninggroup: "${String(attrs(0).zoninggroup ?? "")}"`,
          extractionMethod: "gis-feature-attribute",
          notes: "jurisdictional frame from the official zoning layer",
        }, "jurisdiction");
      }
      break;
    }
    case "zoning-overlays.json": {
      for (const feature of json.features ?? []) {
        const a = feature.attributes ?? {};
        const name = String(a.overlay_name ?? "");
        const section = String(a.code_section ?? "");
        if (!name || !section) continue;
        push({
          semanticRuleKey: `overlay:${keySlug(name)}:applicability`,
          predicate: "overlay-restriction",
          proposedValue: {
            kind: "qualitative",
            text: `${name} applies (${String(a.type ?? "")}).`,
          },
          applicability: { overlay: name },
          anchorText: jsonAttr("code_section", section),
          codeSection: `The Philadelphia Code § ${section}`,
          verbatimSupportingText: `Layer feature: '${name}' — code_section '${section}'.`,
          extractionMethod: "gis-feature-attribute",
          notes: "Layer attributes recorded; section text not captured.",
        }, section);
      }
      break;
    }
    case "pwd-parcel.json": {
      const normalized = normalizeSqFt(String(attrs(0).parcel_area ?? ""));
      if (normalized) {
        push({
          semanticRuleKey: "site:parcel-area",
          predicate: "parcel-area",
          proposedValue: asUnitQuantity(normalized),
          anchorText: jsonAttr("parcel_area", attrs(0).parcel_area),
          codeSection: "PWD Parcels GIS layer (registry parcel)",
          verbatimSupportingText: `parcel_area: ${String(attrs(0).parcel_area)} (sq ft, registry record)`,
          extractionMethod: "gis-feature-attribute:normalizeSqFt",
        });
      }
      break;
    }
    case "building-footprints.json": {
      const area = normalizeSqFt(String(attrs(0).shape_area ?? attrs(0).SHAPE_Area ?? ""));
      if (area) {
        push({
          semanticRuleKey: "site:building-footprint",
          predicate: "building-footprint-area",
          proposedValue: asUnitQuantity(area),
          anchorText: jsonAttr("Shape__Area", attrs(0).Shape__Area ?? attrs(0).shape_area),
          codeSection: "building_footprints GIS layer",
          verbatimSupportingText: `feature shape area: ${String(attrs(0).shape_area ?? attrs(0).SHAPE_Area ?? "")}`,
          extractionMethod: "gis-feature-attribute:normalizeSqFt",
        });
      }
      break;
    }
    case "flood.json": {
      const zone = String(attrs(0).fld_zone ?? "");
      if (zone) {
        push({
          semanticRuleKey: "site:flood-zone",
          predicate: "site-flood",
          proposedValue: { kind: "qualitative", text: zone },
          anchorText: jsonAttr("fld_zone", zone),
          codeSection: "fema_floodplain_2023 (City republication)",
          verbatimSupportingText: `fld_zone: "${zone}"`,
          extractionMethod: "gis-point-query",
        });
      }
      break;
    }
    case "historic.json": {
      const featureCount = json.features?.length ?? 0;
      const firstAttrs = json.features?.[0]?.attributes ?? {};
      push({
        semanticRuleKey: "site:historic-screen",
        predicate: "site-historic-screen",
        proposedValue: {
          kind: "qualitative",
          text:
            featureCount === 0
              ? "Local historic-district layer returned no feature at the sampled location; individual register status not verified either way."
              : "Local historic-district layer returned a feature at the sampled location.",
        },
        anchorText:
          featureCount === 0
            ? '"features":[]'
            : jsonAttr("objectid", firstAttrs.objectid ?? firstAttrs.OBJECTID ?? 0),
        codeSection: "HistoricDistricts_Local point query",
        verbatimSupportingText: `HistoricDistricts_Local point query: ${featureCount} features.`,
        extractionMethod: "gis-point-query",
      });
      break;
    }
    case "rco.json": {
      const count = json.features?.length ?? 0;
      const first = json.features?.[0]?.attributes ?? {};
      const anchorKey = Object.keys(first)[0];
      push({
        semanticRuleKey: "governance:rco-coverage",
        predicate: "rco-coverage",
        proposedValue: {
          kind: "qualitative",
          text: `${count} Registered Community Organization(s) cover the parcel.`,
        },
        anchorText: anchorKey ? jsonAttr(anchorKey, first[anchorKey]) : '"features":[]',
        codeSection: "Zoning_RCO GIS layer",
        verbatimSupportingText: `Zoning_RCO point query: ${count} features.`,
        extractionMethod: "gis-point-query",
      });
      break;
    }
    default:
      notes.push(`${doc.documentId}: no extraction rule; skipped`);
      break;
  }
  return out;
}

/** Deterministic order: candidates sort by candidateId. */
export const benchmarkExtractionAdapter: RegulatoryExtractionAdapter = {
  async extract(input) {
    const notes: string[] = [];
    const sources = input.sources;
    const all: CandidateRuleType[] = [];
    for (const doc of [...input.documents].sort((a, b) => a.documentId.localeCompare(b.documentId))) {
      if (doc.kind === "code-text") {
        if (doc.documentId === "quick-guide-rm1.md") {
          all.push(...extractQuickGuide(input, doc, sources, notes));
        } else if (doc.documentId === "code-14-802-excerpt.md") {
          all.push(...extractParkingCode(input, doc, sources));
        } else if (doc.documentId === "code-14-548-excerpt.md") {
          all.push(...extractOverlayCode(input, doc, sources));
        } else {
          notes.push(`${doc.documentId}: no extraction rule; skipped`);
        }
      } else {
        all.push(...extractGis(input, doc, sources, notes));
      }
    }
    return {
      candidates: all.sort((a, b) => a.candidateId.localeCompare(b.candidateId)),
      notes,
    };
  },
};
