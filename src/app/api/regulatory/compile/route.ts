import { NextResponse } from "next/server";
import type { ResolutionEnvelope } from "../../../../adapters/gis/resolution-envelope";
import type { CommitReceipt } from "../../../../adapters/gis/commit-receipt";
import {
  BaseProjectDriftError,
  rebuildAcceptedProject,
  sha256Project,
  verifyAcceptedPair,
} from "../../../../application/mission/rebuild";
import { compileRegulations } from "../../../../application/regulatory/compile";
import { selectExecutableConstraints } from "../../../../application/regulatory/executable";
import type { CandidateRule } from "../../../../application/regulatory/candidate-rule";
import { ProjectCodec } from "../../../../adapters/persistence/project-codec";
import { loadBenchmarkEvidence } from "../../../../adapters/regulatory/benchmark-evidence";
import { benchmarkExtractionAdapter } from "../../../../adapters/regulatory/benchmark-extractor";
import type { CommandContext } from "../../../../commands";

/**
 * POST /api/regulatory/compile — the compiled-law view for an accepted
 * property (issue #5). PROPERTY BINDING is fail-closed and provenance is
 * TWO-STRANDED: every rule reports LAW (the legal claim/source/locator the
 * rule comes from) separately from APPLIES HERE (the site's own zoning-base
 * or overlay claim + official-GIS source proving the law applies to THIS
 * parcel). Never the first arbitrary claim from the closure.
 */

export const dynamic = "force-dynamic";

const FIXTURE_DIR = "docs/benchmarks/calvary-memorial-philadelphia";
/** The only base district the captured legal corpus covers today. */
const SUPPORTED_DISTRICTS = new Set(["RM-1"]);
/** Jurisdiction-wide legal text sources (never property-specific captures). */
const LAW_SOURCES = new Set(["S5", "S6", "S7"]);

function canonicalDistrict(raw: string | undefined): string | null {
  if (!raw) return null;
  const normalized = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (normalized === "RM1") return "RM-1";
  return raw.trim().toUpperCase();
}

export async function POST(request: Request) {
  let body: { envelope?: ResolutionEnvelope; receipt?: CommitReceipt };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.envelope || !body.receipt) {
    return NextResponse.json(
      { error: "regulatory compile requires the accepted { envelope, receipt } pair" },
      { status: 400 },
    );
  }

  try {
    const { session, receiptPayload } = verifyAcceptedPair(body.envelope, body.receipt);
    const project = rebuildAcceptedProject(session, receiptPayload);
    const baseHash = sha256Project(ProjectCodec.encode(project));
    if (baseHash !== receiptPayload.projectHash) {
      throw new BaseProjectDriftError(
        "the accepted property's committed project could not be reproduced exactly; re-resolve and re-accept the property",
      );
    }

    // Multi-parcel accepted properties fail closed.
    if (session.confirmedParcelIds.length > 1 || session.parcelContexts.length > 1) {
      return NextResponse.json({
        status: "multi-parcel-unsupported",
        reason:
          "This accepted property has multiple confirmed parcels; per-parcel regulatory compilation is required before any law can be presented for it.",
      });
    }

    const context = session.parcelContexts[0];
    const rawDistrict = context?.zoningBase?.districtLong ?? context?.zoningBase?.district;
    const district = canonicalDistrict(rawDistrict);
    const subjectNodeId = `gis:parcel:${session.confirmedParcelIds[0]}`;

    const parcelKey = session.confirmedParcelIds[0];
    const zoningBaseClaimId = `gis:claim:zoning-base:${parcelKey}`;
    const overlayClaimId = `gis:claim:zoning-overlays:${parcelKey}`;
    const zoningBaseClaim = project.nodes[zoningBaseClaimId];
    const overlayClaim = project.nodes[overlayClaimId];

    if (!district || !zoningBaseClaim || zoningBaseClaim.kind !== "claim") {
      return NextResponse.json({
        status: "needs-evidence",
        reason:
          "The accepted property has no verified base zoning district claim in its signed session, so no law can be compiled for it yet. Re-resolve the property.",
      });
    }
    if (!SUPPORTED_DISTRICTS.has(district)) {
      return NextResponse.json({
        status: "unsupported-district",
        district,
        reason:
          `The captured legal corpus covers ${[...SUPPORTED_DISTRICTS].join(", ")}; ` +
          `this accepted property is zoned ${district}. Acrevia will not apply another district's law to it.`,
      });
    }

    // /SIX proof comes ONLY from the signed session's overlay capture AND
    // must exist as the site's own overlay claim in the rebuilt project.
    const overlayNames = (context?.zoningOverlays?.overlays ?? []).map((o) => o.name ?? "");
    const sixProven =
      overlayNames.some((name) => /sixth district overlay/i.test(name)) &&
      overlayClaim?.kind === "claim";

    const evidence = loadBenchmarkEvidence({
      fixtureDir: FIXTURE_DIR,
      subject: { subjectNodeId, jurisdictionKey: "philadelphia-pa", district },
    });
    const extraction = await benchmarkExtractionAdapter.extract(evidence);
    const lawCandidates: CandidateRule[] = extraction.candidates.filter((candidate) => {
      if (!LAW_SOURCES.has(candidate.sourceRef)) return false;
      if (candidate.sourceRef === "S6" && !sixProven) return false;
      return true;
    });

    const ctx: CommandContext = { project, actor: "regulatory-compiler" };
    const compile = compileRegulations(ctx, {
      candidates: lawCandidates,
      sources: evidence.sources,
      subject: { district },
      documents: evidence.documents,
      applicabilityClaims: {
        zoningBaseClaimId,
        overlayClaimIds: overlayClaim?.kind === "claim" ? [overlayClaimId] : [],
      },
    });
    const gate = selectExecutableConstraints(project);

    const supportedBy = (claimIds: string[]): string | undefined => {
      const edge = project.edges.find(
        (e) => e.role === "supported-by" && claimIds.includes(e.dependentId),
      );
      return edge ? edge.dependencyId : undefined;
    };

    const law = gate.decisions
      .filter((decision) => decision.executable)
      .map((decision) => {
        const constraint = gate.executable.find((c) => c.id === decision.constraintId);
        const regulation = project.nodes[decision.regulationId];

        // TWO-STRAND provenance: LAW claims (phl:claim:<rule>) vs APPLIES
        // HERE claims (gis:claim:zoning-*). Never "first found".
        const legalClaimIds = decision.claimIds.filter((id) => id.startsWith("phl:claim:"));
        const applicabilityClaimIds = decision.claimIds.filter((id) => id.startsWith("gis:claim:"));
        const legalClaim = legalClaimIds
          .map((id) => project.nodes[id])
          .find((node) => node?.kind === "claim");
        const legalSourceId = supportedBy(legalClaimIds);
        const legalSource = legalSourceId ? project.nodes[legalSourceId] : undefined;
        const applicabilitySourceId = supportedBy(applicabilityClaimIds);
        const applicabilitySource = applicabilitySourceId
          ? project.nodes[applicabilitySourceId]
          : undefined;

        return {
          constraintId: decision.constraintId,
          constraint,
          value: describeConstraint(constraint),
          law: {
            codeSection: regulation?.kind === "regulation" ? regulation.codeSection : undefined,
            evidence: legalClaim?.kind === "claim" ? legalClaim.evidenceState : undefined,
            verbatim: legalClaim?.kind === "claim" ? legalClaim.verbatimQuote : undefined,
            sourceRef: legalSource?.kind === "source-artifact"
              ? legalSource.logicalSourceKey.replace(/^phl:src:/, "")
              : undefined,
            sourceTitle: legalSource?.kind === "source-artifact" ? legalSource.title : undefined,
          },
          appliesHere: {
            claimId: applicabilityClaimIds[0],
            district: zoningBaseClaim.kind === "claim"
              ? (zoningBaseClaim.value as { text?: string } | undefined)?.text
              : undefined,
            overlay: overlayClaim?.kind === "claim"
              ? (overlayClaim.value as { text?: string } | undefined)?.text?.slice(0, 80)
              : undefined,
            sourceTitle: applicabilitySource?.kind === "source-artifact"
              ? applicabilitySource.title
              : undefined,
            sourceKind: applicabilitySource?.kind === "source-artifact"
              ? "official GIS"
              : "official GIS",
          },
        };
      });

    return NextResponse.json({
      status: "compiled",
      district,
      law,
      conflicts: compile.conflicts.map((conflict) => ({
        predicate: conflict.predicate,
        semanticRuleKey: conflict.semanticRuleKey,
        members: conflict.members.map((member) => ({ ...member })),
        resolution: conflict.resolution,
        explanation: conflict.explanation,
      })),
      decisions: gate.decisions.map(({ constraintId, executable, reasons }) => ({
        constraintId,
        executable,
        reasons,
      })),
      unknowns: compile.outcomes
        .filter((outcome) => outcome.outcome === "unknown-recorded" || outcome.outcome === "abstained")
        .map((outcome) => outcome.semanticRuleKey),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    if (name === "BaseProjectDriftError") {
      return NextResponse.json({ error: error instanceof Error ? error.message : "base project drift", name, reacceptRequired: true }, { status: 409 });
    }
    if (name === "MissingSecretError") {
      return NextResponse.json({ error: "verification secret unavailable", name }, { status: 500 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "compile failed", name }, { status: 400 });
  }
}

function describeConstraint(constraint: unknown): string {
  if (!constraint || typeof constraint !== "object") return "";
  const c = constraint as Record<string, unknown>;
  switch (c.constraintKind) {
    case "height":
      return `${(c.limit as { value: number }).value} ft maximum height`;
    case "parking-requirement": {
      const requirement = c.requirement as { type: string; spaces?: { value: number }; text?: string };
      return requirement.type === "fixed"
        ? `${requirement.spaces?.value} spaces required`
        : requirement.text ?? "formula";
    }
    case "use-permission":
      return `${String(c.use).replace(/-/g, " ")}: ${String(c.permission).replace(/_/g, " ").toLowerCase()}`;
    case "setback": {
      const spec = c.spec as { type: string; min?: { value: number }; range?: { min: number; max: number } };
      if (spec.type === "numeric") return `${spec.min?.value} ft minimum ${c.face} setback`;
      if (spec.type === "range" && spec.range) return `${spec.range.min}\u2013${spec.range.max} ft ${c.face} setback`;
      return `contextual ${c.face} setback (adjacent facades)`;
    }
    case "occupied-area":
      return `max occupied area ${(c.byLotType as { intermediate?: number }).intermediate}% (intermediate lot)`;
    case "density":
      return "tiered minimum lot area per dwelling unit";
    case "overlay-prohibition":
      return `${c.overlay}: ${String(c.prohibits).replace(/-/g, " ")} prohibited`;
    case "density-bonus":
      return "density bonus available by tier";
    default:
      return "";
  }
}
