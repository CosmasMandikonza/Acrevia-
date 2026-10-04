import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full;
  });
}

describe("architecture isolation", () => {
  it("domain code imports no frameworks, storage, network, or UI", () => {
    const forbidden = [
      "react",
      "next",
      "three",
      "node:fs",
      "node:http",
      "node:https",
      "node:path",
      "@ai-sdk",
      "openai",
    ];
    const domainFiles = walk(join(repoRoot, "src", "domain")).filter((file) =>
      file.endsWith(".ts"),
    );
    expect(domainFiles.length).toBeGreaterThan(10);
    for (const file of domainFiles) {
      const source = readFileSync(file, "utf-8");
      for (const pattern of forbidden) {
        expect(
          source.includes(`from "${pattern}`) || source.includes(`from '${pattern}`),
          `${file} must not import ${pattern}`,
        ).toBe(false);
      }
    }
  });

  it("benchmark fixture schemas exist only inside the benchmark adapter", () => {
    const offenders = walk(join(repoRoot, "src")).filter((file) => {
      if (!file.endsWith(".ts")) return false;
      const insideAdapter = file.includes(join("src", "adapters", "benchmarks"));
      const source = readFileSync(file, "utf-8");
      const referencesFixtureTypes =
        source.includes("acrevia.benchmark") ||
        /from ".*benchmarks\/fixture-schema/.test(source);
      return referencesFixtureTypes && !insideAdapter;
    });
    expect(offenders).toEqual([]);
  });

  it("React components do not import domain internals beyond the public barrel", () => {
    const offenders = walk(join(repoRoot, "src", "components"))
      .concat(walk(join(repoRoot, "src", "app")))
      .filter((file) => file.endsWith(".tsx") || file.endsWith(".ts"))
      .filter((file) => readFileSync(file, "utf-8").includes("src/domain/"));
    expect(offenders).toEqual([]);
  });
});
