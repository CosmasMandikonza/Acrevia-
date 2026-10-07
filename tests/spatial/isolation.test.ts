import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADR 0008 boundary: the renderer layer must know NOTHING about zoning or
 * the Development Graph. It consumes the SpatialSceneModel only — semantic
 * wording arrives as data from the adapter. This test greps the renderer
 * sources so the boundary cannot silently erode (#9 will rely on it).
 */

const RENDERER_DIR = join(process.cwd(), "src", "spatial", "renderer");

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
  /zoning/i,
  /setback/i,
  /RM-1/,
  /constraintKind/,
  /selectExecutableConstraints/,
];

describe("spatial renderer isolation (ADR 0008)", () => {
  it("renderer files stay on the scene-model side of the boundary", () => {
    const files = tsFiles(RENDERER_DIR);
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const src = readFileSync(file, "utf-8");
      for (const pattern of FORBIDDEN_IN_RENDERER) {
        expect(src, `${file} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
