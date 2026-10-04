import { describe, expect, it } from "vitest";
import {
  getDependencies,
  getDependents,
  getEvidenceChain,
  explainMetric,
  nodesOfKind,
} from "../../src/domain";
import {
  seedWithBalanceScenario,
  PARKING_CONSTRAINT_ID,
} from "./helpers";

describe("graph traversal", () => {
  const project = seedWithBalanceScenario();

  it("getDependents is the inverse of getDependencies", () => {
    const deps = getDependencies(project, PARKING_CONSTRAINT_ID);
    expect(deps.map((edge) => edge.role)).toContain("materializes");
    for (const edge of deps) {
      const inverse = getDependents(project, edge.dependencyId);
      expect(inverse.some((e) => e.dependentId === PARKING_CONSTRAINT_ID)).toBe(true);
    }
  });

  it("evidence chains terminate at source artifacts with raw evidence pointers", () => {
    const chain = getEvidenceChain(project, PARKING_CONSTRAINT_ID);
    const collect = (node: ReturnType<typeof getEvidenceChain>): string[] => [
      node.kind,
      ...node.children.flatMap(collect),
    ];
    const kinds = collect(chain);
    expect(kinds).toContain("regulation");
    expect(kinds).toContain("claim");
    expect(kinds.filter((kind) => kind === "source-artifact").length).toBeGreaterThan(0);
    // The artifact node in the chain carries its raw evidence pointer.
    type ChainNode = ReturnType<typeof getEvidenceChain>;
    const findArtifact = (node: ChainNode): ChainNode | undefined =>
      node.kind === "source-artifact"
        ? node
        : node.children.map(findArtifact).find(Boolean);
    const artifact = findArtifact(chain);
    expect(artifact?.rawEvidenceRef).toContain("code-14-802-excerpt.md");
  });

  it("explainMetric resolves metric -> scenario -> certificate -> evidence contributions", () => {
    const explanation = explainMetric(project, "homes");
    expect(explanation.scenarioId).toBe("scenario:balance");
    expect(explanation.certificateId).toBe("scenario:balance:certificate");
    expect(explanation.certificateFreshness).toBe("CURRENT");
    const contributed = JSON.stringify(explanation.contributions);
    expect(contributed).toContain(PARKING_CONSTRAINT_ID);
    expect(contributed).toContain("phl:src:S7@v1");
  });

  it("explaining an unknown metric fails loudly", () => {
    expect(() => explainMetric(project, "nonexistent")).toThrow(/metric not found/);
  });

  it("views present scenarios; nothing in the computation layer depends on a view", () => {
    const views = nodesOfKind(project, "stakeholder-view");
    expect(views).toHaveLength(0); // helper does not create views
    const edgesTouchingViews = project.edges.filter((edge) => {
      const node = project.nodes[edge.dependencyId];
      return node?.kind === "stakeholder-view" && edge.role !== "presents";
    });
    expect(edgesTouchingViews).toHaveLength(0);
  });
});
