import type { Project } from "../../domain/graph/project";
import { ProjectCodec } from "./project-codec";

/**
 * Repository contract with optimistic concurrency. Two future collaborators
 * (or agents) cannot silently overwrite each other's project state: a save
 * against a stale expected revision fails loudly.
 */
export interface ProjectRepository {
  get(projectId: string): Promise<Project | null>;
  save(project: Project, expectedRevision: number): Promise<void>;
}

export class RevisionConflictError extends Error {
  readonly expectedRevision: number;
  readonly storedRevision: number;
  readonly projectId: string;

  constructor(projectId: string, expectedRevision: number, storedRevision: number) {
    super(
      `revision conflict on ${projectId}: expected ${expectedRevision}, stored ${storedRevision}`,
    );
    this.name = "RevisionConflictError";
    this.projectId = projectId;
    this.expectedRevision = expectedRevision;
    this.storedRevision = storedRevision;
  }
}

/**
 * In-memory repository. Stores canonical JSON per project and decodes through
 * the codec on read, so every get() is a free round-trip validation and the
 * stored bytes are exactly what any future persistence layer would store.
 */
export class InMemoryProjectRepository implements ProjectRepository {
  private readonly store = new Map<string, string>();

  async get(projectId: string): Promise<Project | null> {
    const json = this.store.get(projectId);
    return json ? ProjectCodec.decode(json) : null;
  }

  async save(project: Project, expectedRevision: number): Promise<void> {
    const existingJson = this.store.get(project.projectId);
    const storedRevision = existingJson
      ? (ProjectCodec.decode(existingJson).revision as number)
      : null;
    // Conflict only against STORED state: a first save of a freshly built
    // project (any revision) overwrites nothing and cannot conflict.
    if (storedRevision !== null && storedRevision !== expectedRevision) {
      throw new RevisionConflictError(project.projectId, expectedRevision, storedRevision);
    }
    this.store.set(project.projectId, ProjectCodec.encode(project));
  }
}
