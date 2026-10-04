import { ProjectSchema, type Project } from "../../domain/graph/project";
import { canonicalJson } from "../../domain/graph/serialization";

/**
 * ProjectCodec — the single persistence boundary.
 *
 * encode: Project -> deterministic canonical JSON string.
 * decode: canonical JSON string -> runtime-validated Project (corrupt or
 *         foreign data fails loudly here, never inside the domain).
 *
 * The production persistence decision (PostgreSQL/PostGIS) is deferred per
 * ADR 0001/0003; whatever persists later persists THIS representation.
 */
export const ProjectCodec = {
  encode(project: Project): string {
    return canonicalJson(project);
  },
  decode(json: string): Project {
    return ProjectSchema.parse(JSON.parse(json)) as unknown as Project;
  },
};
