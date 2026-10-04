import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  SourcesManifest,
  ExpectedRules,
  OpenQuestions,
  ParcelFixture,
  type FixtureRule,
  type FixtureSource,
} from "./fixture-schema";
import {
  addSourceArtifact,
  recordClaim,
  upsertRegulation,
  materializeConstraint,
  openExpertReviewItem,
  markBenchmarkImported,
  type CommandContext,
} from "../../commands";
import {
  createProject,
  addEdge,
  type Project,
} from "../../domain/graph/project";
import { nodeWithMeta } from "../../domain/graph/node";
import { createSha256 } from "../../domain/graph/hashing";
import { validatePropertyRules, type ParcelSemantic, type PropertySemantic } from "../../domain/property/entities";
import type { ClaimValue } from "../../domain/evidence/claim";
import type { ClaimPredicate, AuthorityLevel } from "../../domain/enums";

/**
 * mapBenchmarkToProject — the benchmark adapter (ADR 0002/0003 boundary).
 *
 * Fixture files in, canonical Development Graph out. Fixture types do not leak:
 * everything below maps into domain nodes through domain commands. Where a
 * fixture rule needs interpretation to become executable (tiered density,
 * occupied-area by lot type), that interpretation is made HERE, explicitly, and
 * the fixture's verbatim quote travels on the claim — the interpretation layer
 * is auditable, never silent.
 *
 * Statuses map 1:1 (VERIFIED / SOURCE_CONFIRMED / UNKNOWN). A fixture rule with
 * status UNKNOWN (Philadelphia FAR) becomes an UNKNOWN claim and produces NO
 * regulation and NO constraint. A future ASSUMPTION-status rule must be
 * classified here explicitly as either an Assumption entity or an unsupported
 * datum — never silently recast as sourced evidence.
 */

const AUTHORITY_TO_SOURCE_TYPE: Record<AuthorityLevel, string> = {
  ADOPTED_CODE: "adopted_code",
  OFFICIAL_GIS: "official_gis",
  OFFICIAL_CITY_TOOL: "official_city_tool",
  OFFICIAL_CITY_REFERENCE: "official_city_reference",
  PROPERTY_SELF_REPORTED: "property_self_reported",
  SECONDARY: "secondary",
};

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function rawContentHashFor(rawEvidence: string | undefined, fixtureDir: string): string | undefined {
  if (!rawEvidence) return undefined;
  const parts = rawEvidence
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => join(fixtureDir, part))
    .filter((path) => existsSync(path));
  if (parts.length === 0) return undefined;
  return createSha256(parts.map((path) => readFileSync(path, "utf-8")).join("\n"));
}

export function mapBenchmarkToProject(input: {
  fixtureDir: string;
  actor?: string;
  now?: () => string;
  projectId?: string;
}): Project {
  const fixtureDir = input.fixtureDir;
  const manifest = SourcesManifest.parse(readJson(join(fixtureDir, "sources.manifest.json")));
  const rulesDoc = ExpectedRules.parse(readJson(join(fixtureDir, "rules.expected.json")));
  const questionsDoc = OpenQuestions.parse(readJson(join(fixtureDir, "open-questions.json")));
  const parcelFixture = ParcelFixture.parse(readJson(join(fixtureDir, "parcel.geojson")));
  const parcelProps = parcelFixture.properties as Record<string, unknown>;

  const nowFn = input.now ?? (() => new Date().toISOString());
  const projectId = input.projectId ?? `benchmark:${rulesDoc.property}`;
  const propertyId = "phl:property:calvary-memorial";
  const parcelId = "phl:parcel:778273000";
  const structureId = "phl:structure:bin-1282177";
  const jurisdictionId = "phl:jurisdiction:philadelphia";

  const project = createProject({ projectId, propertyId, now: nowFn() });
  const ctx: CommandContext = { project, actor: input.actor ?? "benchmark-adapter", now: nowFn };

  // --- Sources ------------------------------------------------------------
  const sourceIdFor = (fixtureId: string) => `phl:src:${fixtureId}@v1`;
  const sourceByKey = new Map<string, FixtureSource>();
  for (const source of manifest.sources) {
    sourceByKey.set(source.id, source);
    addSourceArtifact(ctx, {
      id: sourceIdFor(source.id),
      kind: "source-artifact",
      logicalSourceKey: `phl:src:${source.id}`,
      version: 1,
      sourceType: AUTHORITY_TO_SOURCE_TYPE[source.authorityLevel] as never,
      title: source.title,
      publisher: source.publisher,
      canonicalUrl: source.url,
      authority: source.authorityLevel,
      retrievedAt: source.retrievedAt,
      rawContentHash: rawContentHashFor(source.rawEvidence, fixtureDir),
      rawEvidenceRef: source.rawEvidence
        ? join(rulesDoc.property, source.rawEvidence.split(",")[0].trim()).replaceAll("\\", "/")
        : undefined,
      notes: source.notes,
    });
  }

  // --- Property / parcel / structure / jurisdiction ------------------------
  const geometryClaimId = "phl:claim:parcel-geometry-source";
  const parcel: ParcelSemantic = {
    id: parcelId,
    kind: "parcel",
    parcelIdSystem: String(parcelProps.parcelIdSystem ?? "unknown system"),
    parcelNumber: String(parcelProps.parcelNumber ?? "unknown"),
    geometry: {
      geojson: parcelFixture.geometry,
      crs: "EPSG:4326",
      validity: "unchecked",
      derived: false,
      sourceClaimId: geometryClaimId,
    },
    recordedArea: { value: Number(parcelProps.recordedAreaSqFt), unit: "sq_ft" },
    computedAreas: [
      ...(parcelProps.geodesicAreaSqFtPostGIS !== undefined
        ? [{ method: "postgis-geodesic (fixture geodesicAreaSqFtPostGIS)", valueSqFt: Number(parcelProps.geodesicAreaSqFtPostGIS) }]
        : []),
      ...(parcelProps.equirectAreaSqFtCheck !== undefined
        ? [{ method: "equirectangular cross-check (fixture equirectAreaSqFtCheck)", valueSqFt: Number(parcelProps.equirectAreaSqFtCheck) }]
        : []),
    ],
    claimIds: [],
    notes:
      typeof parcelProps.areaWarning === "string"
        ? parcelProps.areaWarning
        : undefined,
  };

  const property: PropertySemantic = {
    id: propertyId,
    kind: "property",
    displayName: "Calvary Memorial Church",
    parcelIds: [parcelId],
    primaryParcelId: parcelId,
    address: {
      text: String(parcelProps.address ?? ""),
      note: "display-only; not project identity",
    },
  };
  const propertyProblems = validatePropertyRules(property);
  if (propertyProblems.length > 0) throw new Error(propertyProblems.join("; "));

  project.nodes[propertyId] = nodeWithMeta(property, nowFn());
  project.nodes[parcelId] = nodeWithMeta(parcel, nowFn());
  addEdge(project, { dependentId: propertyId, dependencyId: parcelId, role: "comprises" });

  project.nodes[structureId] = nodeWithMeta(
    {
      id: structureId,
      kind: "structure",
      parcelId,
      attributeClaimIds: [],
      notes: "BIN 1282177 (city building-footprints layer); height/use/year-built details live on claims",
    },
    nowFn(),
  );
  addEdge(project, { dependentId: structureId, dependencyId: parcelId, role: "located-on" });

  project.nodes[jurisdictionId] = nodeWithMeta(
    {
      id: jurisdictionId,
      kind: "jurisdiction",
      jurisdiction: { city: "Philadelphia", state: "PA", country: "US" },
      method: "official-gis-point-intersect (L&I zoning layers, parcel centroid)",
      claimIds: [],
    },
    nowFn(),
  );

  // --- Rules -> claims / regulations / constraints -------------------------
  const claimIdFor = (ruleId: string) => `phl:claim:${ruleId.replace(/^phl-/, "")}`;
  const regIdFor = (ruleId: string) => `phl:reg:${ruleId.replace(/^phl-/, "")}`;
  const conIdFor = (ruleId: string) => `phl:constraint:${ruleId.replace(/^phl-/, "")}`;
  const jurisdictionClaimIds: string[] = [];
  const structureClaimIds: string[] = [];

  const baseClaim = (
    rule: FixtureRule,
    value: ClaimValue,
    overrides: { id?: string; predicate?: ClaimPredicate } = {},
  ) => ({
    id: overrides.id ?? claimIdFor(rule.id),
    kind: "claim" as const,
    subjectNodeId: parcelId,
    predicate: overrides.predicate ?? (rule.category as ClaimPredicate),
    value,
    origin: { kind: "SOURCE_DERIVED" as const },
    sourceIds: [sourceIdFor(rule.sourceRef)],
    evidenceState: rule.status === "ASSUMPTION" ? undefined : rule.status,
    verbatimQuote: rule.verbatimQuote,
    notes: [rule.notes, `retrievedAt: ${rule.retrievedAt}`].filter(Boolean).join(" | ") || undefined,
  });

  const addRegulation = (rule: FixtureRule, extra: Record<string, unknown> = {}) =>
    upsertRegulation(ctx, {
      id: regIdFor(rule.id),
      kind: "regulation",
      jurisdictionKey: "philadelphia-pa",
      codeSection: rule.codeSection ?? rule.statement,
      applicability: { district: "RM-1" },
      claimIds: [claimIdFor(rule.id)],
      currentness: "CURRENT",
      conflictRefs: [],
      ...extra,
    });

  const PREDICATE_FOR_RULE: Record<string, ClaimPredicate> = {
    "phl-density-formula": "density-formula",
    "phl-setback-front": "setback-front",
    "phl-parking-religious-assembly": "parking-requirement",
    "phl-overlay-six-applicability": "overlay-restriction",
    "phl-overlay-sign-controls-roosevelt": "overlay-restriction",
    "phl-overlay-childcare-standards": "overlay-restriction",
    "phl-overlay-nis": "overlay-restriction",
    "phl-rco-coverage": "rco-coverage",
    "phl-site-flood": "site-flood",
    "phl-site-historic-screen": "site-historic-screen",
    "phl-site-parcel-area": "parcel-area",
  };

  const rulesById = new Map(rulesDoc.rules.map((rule) => [rule.id, rule]));

  for (const rule of rulesDoc.rules) {
    switch (rule.id) {
      case "phl-jurisdiction":
        // Covered by the jurisdiction node itself.
        break;

      case "phl-zoning-district": {
        recordClaim(ctx, baseClaim(rule, { type: "qualitative", text: "RM-1" }, { predicate: "zoning-district" }));
        jurisdictionClaimIds.push(claimIdFor(rule.id));
        break;
      }

      case "phl-use-multifamily":
      case "phl-use-religious-assembly":
      case "phl-use-childcare": {
        recordClaim(ctx, baseClaim(rule, { type: "qualitative", text: String(rule.value ?? "") }, { predicate: "use-permission" }));
        addRegulation(rule, {
          applicability: { district: "RM-1", use: rule.id.replace("phl-use-", "") },
        });
        materializeConstraint(ctx, {
          id: conIdFor(rule.id),
          kind: "constraint",
          constraintKind: "use-permission",
          regulationId: regIdFor(rule.id),
          use: rule.id.replace("phl-use-", ""),
          permission:
            rule.id === "phl-use-religious-assembly" ? "SPECIAL_EXCEPTION" : "BY_RIGHT",
        });
        break;
      }

      case "phl-lot-width-min":
      case "phl-lot-area-min": {
        recordClaim(
          ctx,
          baseClaim(rule, { type: "quantity", quantity: { value: Number(rule.value), unit: rule.id === "phl-lot-width-min" ? "ft" : "sq_ft" } }, { predicate: rule.id === "phl-lot-width-min" ? "lot-width" : "lot-area" }),
        );
        // Dimensional evidence without a constraint variant yet: regulation only.
        addRegulation(rule);
        break;
      }

      case "phl-density-formula": {
        recordClaim(ctx, baseClaim(rule, { type: "null", reason: "formula-only" }, { predicate: PREDICATE_FOR_RULE[rule.id] }));
        addRegulation(rule);
        materializeConstraint(ctx, {
          id: conIdFor(rule.id),
          kind: "constraint",
          constraintKind: "density",
          regulationId: regIdFor(rule.id),
          spec: {
            type: "tiered-min-lot-area-per-unit",
            tiers: [
              { firstSqFt: 1440, perUnit: 360 },
              { firstSqFt: 1440, perUnit: 480 },
            ],
            rounding: "down",
          },
          notes: "Tier values transcribed from the fixture's quoted guide note [1]; second tier applies above the first 1,440 sq ft.",
        });
        break;
      }

      case "phl-occupied-area-max": {
        recordClaim(ctx, baseClaim(rule, { type: "qualitative", text: "Intermediate 75%; Corner 80%" }, { predicate: "occupied-area" }));
        addRegulation(rule);
        materializeConstraint(ctx, {
          id: conIdFor(rule.id),
          kind: "constraint",
          constraintKind: "occupied-area",
          regulationId: regIdFor(rule.id),
          byLotType: { intermediate: 75, corner: 80 },
          unit: "percent",
        });
        break;
      }

      case "phl-setback-front": {
        recordClaim(ctx, baseClaim(rule, { type: "null", reason: "formula-only" }, { predicate: PREDICATE_FOR_RULE[rule.id] }));
        addRegulation(rule);
        materializeConstraint(ctx, {
          id: conIdFor(rule.id),
          kind: "constraint",
          constraintKind: "setback",
          regulationId: regIdFor(rule.id),
          face: "front",
          spec: {
            type: "contextual",
            ruleId: "adjacent-facades",
            description: "Front facade placement follows immediately adjacent / blockface buildings (guide notes [5],[6])",
          },
        });
        break;
      }

      case "phl-setback-side": {
        recordClaim(ctx, baseClaim(rule, { type: "range", range: { min: 5, max: 12, unit: "ft" } }, { predicate: "setback-side" }));
        addRegulation(rule);
        materializeConstraint(ctx, {
          id: conIdFor(rule.id),
          kind: "constraint",
          constraintKind: "setback",
          regulationId: regIdFor(rule.id),
          face: "side",
          spec: { type: "range", range: { min: 5, max: 12, unit: "ft" } },
        });
        break;
      }

      case "phl-setback-rear": {
        recordClaim(ctx, baseClaim(rule, { type: "quantity", quantity: { value: 9, unit: "ft" } }, { predicate: "setback-rear" }));
        addRegulation(rule);
        materializeConstraint(ctx, {
          id: conIdFor(rule.id),
          kind: "constraint",
          constraintKind: "setback",
          regulationId: regIdFor(rule.id),
          face: "rear",
          spec: { type: "numeric", min: { value: 9, unit: "ft" } },
        });
        break;
      }

      case "phl-height-max": {
        recordClaim(ctx, baseClaim(rule, { type: "quantity", quantity: { value: 38, unit: "ft" } }, { predicate: "max-height" }));
        addRegulation(rule);
        materializeConstraint(ctx, {
          id: conIdFor(rule.id),
          kind: "constraint",
          constraintKind: "height",
          regulationId: regIdFor(rule.id),
          limit: { value: 38, unit: "ft" },
          appliesTo: "principal-structure",
        });
        break;
      }

      case "phl-far": {
        // UNKNOWN stays UNKNOWN. No regulation, no constraint, no default.
        recordClaim(ctx, baseClaim(rule, { type: "null", reason: "unknown" }, { predicate: "far" }));
        break;
      }

      case "phl-parking-multifamily": {
        recordClaim(
          ctx,
          baseClaim(rule, { type: "quantity", quantity: { value: 0, unit: "spaces" } }, { predicate: "parking-requirement" }),
        );
        addRegulation(rule, {
          codeSection: rule.codeSection ?? "§ 14-802(2), Table 14-802-1",
          applicability: { district: "RM-1", use: "multi-family" },
        });
        materializeConstraint(ctx, {
          id: conIdFor(rule.id),
          kind: "constraint",
          constraintKind: "parking-requirement",
          regulationId: regIdFor(rule.id),
          use: "multi-family",
          requirement: { type: "fixed", spaces: { value: 0, unit: "spaces" } },
        });
        break;
      }

      case "phl-parking-religious-assembly": {
        recordClaim(ctx, baseClaim(rule, { type: "null", reason: "formula-only" }, { predicate: PREDICATE_FOR_RULE[rule.id] }));
        addRegulation(rule, {
          applicability: { district: "RM-1", use: "religious-assembly" },
        });
        materializeConstraint(ctx, {
          id: conIdFor(rule.id),
          kind: "constraint",
          constraintKind: "parking-requirement",
          regulationId: regIdFor(rule.id),
          use: "religious-assembly",
          requirement: {
            type: "formula",
            formulaId: "religious-assembly",
            text: "1/10 seats or 1/1,000 sq ft, whichever is greater",
          },
        });
        break;
      }

      case "phl-overlay-six-adu-prohibition": {
        recordClaim(ctx, baseClaim(rule, { type: "qualitative", text: "ADUs prohibited" }, { predicate: "overlay-restriction" }));
        addRegulation(rule, { applicability: { overlay: "/SIX" } });
        materializeConstraint(ctx, {
          id: conIdFor(rule.id),
          kind: "constraint",
          constraintKind: "overlay-prohibition",
          regulationId: regIdFor(rule.id),
          overlay: "/SIX",
          prohibits: "accessory-dwelling-units",
        });
        break;
      }

      case "phl-overlay-six-applicability":
      case "phl-overlay-sign-controls-roosevelt":
      case "phl-overlay-childcare-standards":
      case "phl-overlay-nis": {
        recordClaim(ctx, baseClaim(rule, { type: "qualitative", text: rule.statement }, { predicate: PREDICATE_FOR_RULE[rule.id] }));
        jurisdictionClaimIds.push(claimIdFor(rule.id));
        break;
      }

      case "phl-bonus-mixed-income": {
        recordClaim(ctx, baseClaim(rule, { type: "quantity", quantity: { value: 25, unit: "percent" } }, { predicate: "density-bonus" }));
        addRegulation(rule);
        materializeConstraint(ctx, {
          id: conIdFor(rule.id),
          kind: "constraint",
          constraintKind: "density-bonus",
          regulationId: regIdFor(rule.id),
          percentIncreaseByTier: { moderate: 25, low: 50 },
          geographicRestriction: "unknown",
          statuteRef: "§ 14-702(7)",
        });
        break;
      }

      case "phl-rco-coverage": {
        recordClaim(ctx, baseClaim(rule, { type: "qualitative", text: rule.statement }, { predicate: PREDICATE_FOR_RULE[rule.id] }));
        break;
      }

      case "phl-site-building": {
        recordClaim(ctx, baseClaim(rule, { type: "quantity", quantity: { value: 31272, unit: "sq_ft" } }, { predicate: "building-footprint-area" }));
        structureClaimIds.push(claimIdFor(rule.id));
        recordClaim(ctx, baseClaim(rule, { type: "qualitative", text: "Calvary Memorial Church" }, { id: "phl:claim:building-name", predicate: "building-name" }));
        structureClaimIds.push("phl:claim:building-name");
        recordClaim(ctx, baseClaim(rule, { type: "qualitative", text: "HSE WORSHIP ALL 1 STY MAS (OPA)" }, { id: "phl:claim:building-use", predicate: "building-use" }));
        structureClaimIds.push("phl:claim:building-use");
        break;
      }

      case "phl-site-flood":
      case "phl-site-historic-screen":
      case "phl-site-parcel-area": {
        const value =
          rule.id === "phl-site-parcel-area"
            ? ({ type: "quantity", quantity: { value: 119295, unit: "sq_ft" } } as const)
            : ({ type: "qualitative", text: rule.statement } as const);
        recordClaim(ctx, baseClaim(rule, value, { predicate: PREDICATE_FOR_RULE[rule.id] }));
        if (rule.id === "phl-site-parcel-area") {
          (project.nodes[parcelId] as unknown as { claimIds: string[] }).claimIds.push(claimIdFor(rule.id));
        }
        break;
      }

      default:
        throw new Error(`benchmark adapter: no mapping defined for rule ${rule.id}`);
    }
  }

  // Geometry provenance claim + owner-of-record claim (from parcel properties).
  const s2 = sourceByKey.get("S2");
  if (s2) {
    recordClaim(ctx, {
      id: geometryClaimId,
      kind: "claim",
      subjectNodeId: parcelId,
      predicate: "parcel-area",
      value: { type: "qualitative", text: "PWD parcel polygon (WGS84) with recorded gross_area 119295 sq ft" },
      origin: { kind: "SOURCE_DERIVED" as const },
      sourceIds: [sourceIdFor("S2")],
      evidenceState: "SOURCE_CONFIRMED",
      verbatimQuote: "pwd_parcels: {\"brt_id\": \"778273000\", \"gross_area\": 119295}",
      notes: "Grounding claim for the parcel geometry; links the parcel to its source artifact for certificate closures.",
    });
    addEdge(project, { dependentId: parcelId, dependencyId: geometryClaimId, role: "grounded-in" });
    (project.nodes[parcelId] as unknown as { claimIds: string[] }).claimIds.push(geometryClaimId);

    recordClaim(ctx, {
      id: "phl:claim:owner-of-record",
      kind: "claim",
      subjectNodeId: propertyId,
      predicate: "owner-of-record",
      value: { type: "qualitative", text: String(parcelProps.ownerOfRecord ?? "unknown") },
      origin: { kind: "SOURCE_DERIVED" as const },
      sourceIds: [sourceIdFor("S2")],
      evidenceState: "SOURCE_CONFIRMED",
      verbatimQuote: `pwd_parcels.owner1: "${String(parcelProps.ownerOfRecord ?? "")}"`,
    });
    (project.nodes[propertyId] as unknown as { ownerOfRecordClaimId?: string }).ownerOfRecordClaimId =
      "phl:claim:owner-of-record";
  }

  (project.nodes[structureId] as unknown as { attributeClaimIds: string[] }).attributeClaimIds.push(
    ...structureClaimIds,
  );
  (project.nodes[jurisdictionId] as unknown as { claimIds: string[] }).claimIds.push(
    ...jurisdictionClaimIds,
  );

  // --- Open questions -> expert review items -------------------------------
  const farRule = rulesById.get("phl-far");
  for (const question of questionsDoc.questions) {
    openExpertReviewItem(ctx, {
      id: `phl:review:${question.id}`,
      kind: "expert-review",
      question: question.question,
      whyItMatters: question.whyItMatters,
      category: question.category,
      affectedNodeIds:
        question.category === "far" && farRule
          ? [claimIdFor(farRule.id)]
          : question.category === "overlay"
            ? [claimIdFor("phl-overlay-six-applicability")]
            : [],
      evidenceRefs: [],
      severity: question.kind === "EXPERT_REQUIRED" ? "blocking" : "non-blocking",
      reviewStatus: "OPEN",
    });
  }

  markBenchmarkImported(ctx, {
    summary: `import benchmark fixture ${rulesDoc.property} (${manifest.sources.length} sources, ${rulesDoc.rules.length} rules, ${questionsDoc.questions.length} open questions)`,
    affectedNodeIds: Object.keys(project.nodes),
  });

  return project;
}
