import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { commitSession, IncompleteSessionError, InvalidGeometryError } from "../../../../application/resolution/commit";
import { ProjectCodec } from "../../../../adapters/persistence/project-codec";
import { verifyEnvelope, type ResolutionEnvelope } from "../../../../adapters/gis/resolution-envelope";
import { createCommitReceipt } from "../../../../adapters/gis/commit-receipt";

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
    // ONE timestamp for the commit AND the receipt: reconstruction replays
    // commitSession with receipt.committedAt, so both must be the exact same
    // value for the rebuilt base project to be byte-identical to this commit.
    const commitNow = new Date().toISOString();
    const { project } = commitSession(session, {
      projectId: body.projectId,
      propertyId: body.propertyId,
      actor: "church-leader",
      now: commitNow,
    });
    const encoded = ProjectCodec.encode(project);
    // Server attestation that the commit happened: signed ONLY after the
    // atomic commit and whole-result integrity encode succeed. The receipt
    // binds the commit metadata — including the committed project's
    // canonical hash — to this exact envelope signature and session, so any
    // later reconstruction must reproduce THESE bytes or fail closed.
    const nodeCount = Object.keys(project.nodes).length;
    const eventCount = project.events.length;
    const receipt = createCommitReceipt({
      projectId: project.projectId,
      propertyId: body.propertyId,
      sessionId: session.sessionId,
      envelopeSignature: body.envelope.signature,
      revision: project.revision,
      nodeCount,
      eventCount,
      committedAt: commitNow,
      projectHash: createHash("sha256").update(encoded, "utf-8").digest("hex"),
      commitVersion: "1",
    });
    return NextResponse.json({
      projectId: project.projectId,
      revision: project.revision,
      nodeCount,
      eventCount,
      committedAt: commitNow,
      project: JSON.parse(encoded),
      receipt,
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
