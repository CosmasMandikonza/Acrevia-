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
import { ProjectCodec } from "../../../../adapters/persistence/project-codec";
import { loadBenchmarkEvidence } from "../../../../adapters/regulatory/benchmark-evidence";
import { benchmarkExtractionAdapter } from "../../../../adapters/regulatory/benchmark-extractor";
import type { CommandContext } from "../../../../commands";

/**
 * POST /api/regulatory/compile — the compiled-law view for an accepted
 * property (issue #5). Verifies the accepted { envelope, receipt } pair,
 * rebuilds the committed base project (hash-gated), runs the deterministic
 * regulatory compiler over the captured raw evidence for the property's
 * district, and returns the executable law + visible conflicts + per-rule
 * executability reasons. Stateless and deterministic: the same verified pair
 * and committed evidence always produce the same compiled law.
 */

export const dynamic = "force-dynamic";

const FIXTURE_DIR = "docs/benchmarks/calvary-memorial-philadelphia";

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

    const district =
      session.parcelContexts[0]?.zoningBase?.district ??
      session.parcelContexts[0]?.zoningBase?.districtLong;
    const subjectNodeId = `gis:parcel:${session.confirmedParcelIds[0]}`;

    const evidence = loadBenchmarkEvidence({
      fixtureDir: FIXTURE_DIR,
      subject: {
        subjectNodeId,
        jurisdictionKey: "philadelphia-pa",
        district: district ?? "RM-1",
      },
    });
    const extraction = await benchmarkExtractionAdapter.extract(evidence);
    const ctx: CommandContext = { project, actor: "regulatory-compiler" };
    const compile = compileRegulations(ctx, {
      candidates: extraction.candidates,
      sources: evidence.sources,
      subject: { district: district ?? "RM-1" },
    });
    const gate = selectExecutableConstraints(project);
    const sourceTitles = new Map(evidence.sources.map((s) => [s.sourceRef, s.title]));

    const law = gate.decisions
      .filter((decision) => decision.executable)
      .map((decision) => {
        const constraint = gate.executable.find((c) => c.id === decision.constraintId);
        const claim = decision.claimIds
          .map((id) => project.nodes[id])
          .find((node) => node?.kind === "claim");
        const regulation = project.nodes[decision.regulationId];
        const sourceRef = decision.sourceIds
          .map((id) => project.nodes[id])
          .find((node) => node?.kind === "source-artifact");
        return {
          constraintId: decision.constraintId,
          constraint,
          value: describeConstraint(constraint),
          codeSection:
            regulation?.kind === "regulation" ? regulation.codeSection : undefined,
          evidence: claim?.kind === "claim" ? claim.evidenceState : undefined,
          verbatim: claim?.kind === "claim" ? claim.verbatimQuote : undefined,
          sourceRef: sourceRef?.kind === "source-artifact"
            ? sourceRef.logicalSourceKey.replace(/^phl:src:/, "")
            : undefined,
          sourceTitle: sourceRef?.kind === "source-artifact" ? sourceRef.title : undefined,
        };
      });

    return NextResponse.json({
      district: district ?? "RM-1",
      law,
      conflicts: compile.conflicts.map((conflict) => ({
        predicate: conflict.predicate,
        members: conflict.members.map((member) => ({
          ...member,
          sourceTitle: sourceTitles.get(member.sourceRef) ?? member.sourceRef,
        })),
        resolution: conflict.resolution,
        explanation: conflict.explanation,
      })),
      decisions: gate.decisions.map(({ constraintId, executable, reasons }) => ({
        constraintId,
        executable,
        reasons,
      })),
      unknowns: compile.outcomes
        .filter((outcome) => outcome.outcome === "unknown-recorded")
        .map((outcome) => outcome.predicate),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    if (name === "PairVerificationError") {
      return NextResponse.json({ error: error instanceof Error ? error.message : "verification failed", name }, { status: 403 });
    }
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
      if (spec.type === "range" && spec.range) return `${spec.range.min}–${spec.range.max} ft ${c.face} setback`;
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
