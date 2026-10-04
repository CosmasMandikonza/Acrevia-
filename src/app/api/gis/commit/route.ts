import { NextResponse } from "next/server";
import { commitSession, IncompleteSessionError, InvalidGeometryError } from "../../../../application/resolution/commit";
import { ProjectCodec } from "../../../../adapters/persistence/project-codec";
import { verifyEnvelope, type ResolutionEnvelope } from "../../../../adapters/gis/resolution-envelope";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {
    envelope?: ResolutionEnvelope;
    projectId?: string;
    propertyId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.envelope || !body.projectId || !body.propertyId) {
    return NextResponse.json({ error: "commit requires envelope, projectId, propertyId" }, { status: 400 });
  }

  try {
    const session = verifyEnvelope(body.envelope);
    const { project } = commitSession(session, {
      projectId: body.projectId,
      propertyId: body.propertyId,
      actor: "church-leader",
      now: new Date().toISOString(),
    });
    const encoded = ProjectCodec.encode(project);
    return NextResponse.json({
      projectId: project.projectId,
      revision: project.revision,
      nodeCount: Object.keys(project.nodes).length,
      eventCount: project.events.length,
      project: JSON.parse(encoded),
    });
  } catch (error) {
    if (error instanceof IncompleteSessionError) {
      return NextResponse.json(
        { error: error.message, name: error.name, atomic: true, partialStateWritten: false, reason: "session-not-confirmed" },
        { status: 409 },
      );
    }
    if (error instanceof InvalidGeometryError) {
      return NextResponse.json(
        { error: error.message, name: error.name, atomic: true, partialStateWritten: false, reason: "invalid-geometry-gate" },
        { status: 422 },
      );
    }
    const isSignature = error instanceof Error && error.name === "EnvelopeSignatureError";
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "commit failed",
        name: error instanceof Error ? error.name : "Error",
        atomic: true,
        partialStateWritten: false,
        tampered: isSignature,
      },
      { status: isSignature ? 403 : 500 },
    );
  }
}
