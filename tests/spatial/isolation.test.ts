import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADR 0008 boundary (strengthened for issue #9): renderer layers must know
 * NOTHING about zoning or the Development Graph. They consume the
 * SpatialSceneModel only — semantic wording arrives as data from the
 * adapter. This test greps BOTH the spike renderer (src/spatial/renderer)
 * and the production Forge renderer (src/components/forge) so the boundary
 * cannot silently erode in either place.
 */

const RENDERER_DIRS = [
  join(process.cwd(), "src", "spatial", "renderer"),
  join(process.cwd(), "src", "components", "forge"),
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const FORBIDDEN_IN_RENDERER: RegExp[] = [
  /from\s+["'].*domain/,
  /from\s+["'].*adapters/,
  /from\s+["'].*commands/,
  /from\s+["'].*application/,
  /zoning/i,
  /setback/i,
  /RM-1/,
  /constraintKind/,
  /selectExecutableConstraints/,
  /solve\(/,
];

describe("spatial renderer isolation (ADR 0008, strengthened for #9)", () => {
  it("renderer files stay on the scene-model side of the boundary", () => {
    const files = RENDERER_DIRS.flatMap(tsFiles);
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN_IN_RENDERER) {
        expect(src, `${file} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
