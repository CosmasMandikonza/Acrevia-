import { createHash } from "node:crypto";
import { z } from "zod";
import {
  verifyEnvelope,
  hmacFor,
  MissingSecretError,
  type ResolutionEnvelope,
} from "../../adapters/gis/resolution-envelope";
import {
  assertReceiptMatchesEnvelope,
  verifyCommitReceipt,
  type CommitReceipt,
} from "../../adapters/gis/commit-receipt";
import { commitSession } from "../resolution/commit";
import {
  confirmMissionConstraint,
  retractMissionConstraint,
  type CommandContext,
} from "../../commands";
import { ProjectCodec } from "../../adapters/persistence/project-codec";
import { MissionConstraintSemantic } from "../../domain/constraints/mission";
import type { Project } from "../../domain/graph/project";

/**
 * Mission Compiler project-state bridge (issue #6).
 *
 * The GIS commit API is stateless by design, and the committed Project JSON
 * it returns is discarded by the client. The Mission Compiler needs a
 * trustworthy mutable project snapshot — this module is the smallest
 * trust-preserving bridge:
 *
 *   1. verify the { envelope, receipt } pair exactly as /api/gis/verify does
 *      (both HMACs + mutual consistency);
 *   2. RECONSTRUCT the committed project deterministically — commitSession
 *      is a pure function of the verified session, so rebuilding with
 *      now = receipt.committedAt reproduces the committed graph exactly;
 *   3. replay the client-held mission command log through the typed command
 *      boundary (every command re-validated; any failure aborts atomically);
 *   4. ProjectCodec.encode() integrity gate;
 *   5. return the project plus a signed attestation binding the exact
 *      envelope signature, command count, revision, and project hash.
 *
 * There is no database and no parallel truth model: the signed pair remains
 * the root of external truth; mission commands are user intent (USER_DECLARED
 * by construction) validated at every replay; the rendered project is always
 * server-derived.
 */

export class PairVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PairVerificationError";
  }
}

/** Verify the stored pair with the same five checks as /api/gis/verify. */
export function verifyAcceptedPair(
  envelope: ResolutionEnvelope,
  receipt: CommitReceipt,
): { session: ResolutionEnvelope["session"]; receiptPayload: CommitReceipt["payload"] } {
  try {
    const session = verifyEnvelope(envelope);
    const receiptPayload = verifyCommitReceipt(receipt);
    assertReceiptMatchesEnvelope(receiptPayload, envelope);
    return { session, receiptPayload };
  } catch (cause) {
    if (cause instanceof MissingSecretError) throw cause; // fail closed, distinct
    throw new PairVerificationError(
      cause instanceof Error ? cause.message : "verification failed",
    );
  }
}

/** The typed mission command log the client holds (user intent, unsigned). */
export const MissionCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("confirm"), input: MissionConstraintSemantic }).strict(),
  z.object({ kind: z.literal("retract"), input: z.object({ id: z.string().min(1) }).strict() }).strict(),
]);
export type MissionCommand = z.infer<typeof MissionCommand>;

export const MissionCommandLog = z.array(MissionCommand).max(200);
export type MissionCommandLog = z.infer<typeof MissionCommandLog>;

export type MissionStateAttestation = {
  projectId: string;
  envelopeSignature: string;
  commandCount: number;
  revision: number;
  projectHash: string;
  signature: string;
};

export type MissionConstraintView = {
  id: string;
  intentText: string;
  normalized: MissionConstraintSemantic["normalized"];
  hardOrSoft: "hard" | "soft";
  revision: number;
  lastModifiedAt: string;
};

export type MissionStateResult = {
  projectId: string;
  revision: number;
  eventCount: number;
  missionConstraints: MissionConstraintView[];
  project: unknown;
  attestation: MissionStateAttestation;
};

export class CommandReplayError extends Error {
  constructor(
    message: string,
    readonly commandIndex: number,
  ) {
    super(message);
    this.name = "CommandReplayError";
  }
}

/** Deterministically rebuild the committed project from the verified pair. */
export function rebuildAcceptedProject(
  session: ResolutionEnvelope["session"],
  receiptPayload: CommitReceipt["payload"],
): Project {
  const { project } = commitSession(session, {
    projectId: receiptPayload.projectId,
    propertyId: receiptPayload.propertyId,
    actor: "church-leader",
    now: receiptPayload.committedAt,
  });
  return project;
}

/**
 * Apply the mission command log through the typed command boundary.
 * Deterministic by construction: each event is stamped with the timestamp the
 * USER_DECLARED command itself carries (declaredAt), falling back to the
 * receipt's committedAt — never wall-clock time — so replaying the same log
 * over the same accepted session always yields byte-identical project state.
 */
export function replayMissionCommands(
  project: Project,
  commands: MissionCommand[],
  context: Pick<CommandContext, "actor"> & { correlationId?: string; fallbackAt?: string },
): void {
  let eventAt = context.fallbackAt ?? new Date().toISOString();
  const ctx: CommandContext = {
    project,
    actor: context.actor,
    correlationId: context.correlationId,
    now: () => eventAt,
  };
  commands.forEach((command, index) => {
    try {
      if (command.kind === "confirm") {
        if (command.input.origin.kind === "USER_DECLARED" && command.input.origin.declaredAt) {
          eventAt = command.input.origin.declaredAt;
        }
        confirmMissionConstraint(ctx, command.input);
      } else {
        retractMissionConstraint(ctx, command.input);
      }
    } catch (cause) {
      throw new CommandReplayError(
        cause instanceof Error ? cause.message : "command rejected",
        index,
      );
    }
  });
}

export function buildMissionState(
  envelope: ResolutionEnvelope,
  receipt: CommitReceipt,
  commands: MissionCommand[],
): MissionStateResult {
  const { session, receiptPayload } = verifyAcceptedPair(envelope, receipt);
  const project = rebuildAcceptedProject(session, receiptPayload);
  replayMissionCommands(project, commands, {
    actor: "church-leader",
    fallbackAt: receiptPayload.committedAt,
  });

  const encoded = ProjectCodec.encode(project);

  const missionConstraints: MissionConstraintView[] = Object.values(project.nodes)
    .filter((node) => node.kind === "mission-constraint")
    .filter((node) => node.confirmationState === "CONFIRMED")
    .map((node) => ({
      id: node.id,
      intentText: node.intentText,
      normalized: node.normalized,
      hardOrSoft: node.hardOrSoft,
      revision: node.meta.revision,
      lastModifiedAt: node.meta.lastModifiedAt,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const projectHash = createHash("sha256").update(encoded, "utf-8").digest("hex");
  const attestationPayload = {
    projectId: receiptPayload.projectId,
    envelopeSignature: receiptPayload.envelopeSignature,
    commandCount: commands.length,
    revision: project.revision,
    projectHash,
  };

  return {
    projectId: project.projectId,
    revision: project.revision,
    eventCount: project.events.length,
    missionConstraints,
    project: JSON.parse(encoded),
    attestation: {
      ...attestationPayload,
      signature: hmacFor(attestationPayload),
    },
  };
}
