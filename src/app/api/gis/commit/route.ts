import { NextResponse } from "next/server";
import { ResolutionSession } from "../../../../application/resolution/state";
import { commitSession, IncompleteSessionError } from "../../../../application/resolution/commit";
import { ProjectCodec } from "../../../../adapters/persistence/project-codec";
import { canonicalJson } from "../../../../domain/graph/serialization";

export const dynamic = "force-dynamic";

/**
 * POST /api/gis/commit — atomic commit of a CONFIRMED resolution session into
 * a Development Graph project. The whole mutation set is staged + integrity
 * validated inside commitResolvedSite; on failure nothing is returned but an
 * error, and no partial project exists. The committed project returns as a
 * canonical JSON payload the client (and future persistence) can round-trip
 * through ProjectCodec.
 */
export async function POST(request: Request) {
  let body: {
    session?: unknown;
    projectId?: string;
    propertyId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.session || !body.projectId || !body.propertyId) {
    return NextResponse.json({ error: "commit requires session, projectId, propertyId" }, { status: 400 });
  }

  try {
    const session = ResolutionSession.parse(body.session);
    const { project, plan } = commitSession(session, {
      projectId: body.projectId,
      propertyId: body.propertyId,
      actor: "church-leader",
      now: new Date().toISOString(),
    });
    // The response payload is the codec-validated canonical serialization —
    // what any future durable repository would store.
    const encoded = ProjectCodec.encode(project);
    void plan;
    return NextResponse.json({
      projectId: project.projectId,
      revision: project.revision,
      nodeCount: Object.keys(project.nodes).length,
      eventCount: project.events.length,
      project: JSON.parse(encoded),
      canonicalLength: encoded.length,
    });
  } catch (error) {
    const incomplete = error instanceof IncompleteSessionError;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "commit failed",
        name: error instanceof Error ? error.name : "Error",
        atomic: true,
        partialStateWritten: false,
        reason: incomplete ? "session-not-confirmed" : "staged-commit-failed",
      },
      { status: incomplete ? 409 : 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ error: "POST only" }, { status: 405 });
}

// Keep the canonical serializer referenced for tree-shaking clarity in builds.
void canonicalJson;
