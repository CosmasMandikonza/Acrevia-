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
    const collect = (node: ReturnType<typeof getEvidenceChain>): Array<string | null> => [
      node.kind,
      ...node.children.flatMap(collect),
    ];
    const kinds = collect(chain).filter((kind): kind is string => kind !== null);
    expect(kinds).toContain("regulation");
    expect(kinds).toContain("claim");
    expect(kinds.filter((kind) => kind === "source-artifact").length).toBeGreaterThan(0);
    type ChainNode = ReturnType<typeof getEvidenceChain>;
    const findArtifact = (node: ChainNode): ChainNode | undefined =>
      node.kind === "source-artifact"
        ? node
        : node.children.map(findArtifact).find(Boolean);
    const artifact = findArtifact(chain);
    expect(artifact?.rawEvidenceRef).toContain("code-14-802-excerpt.md");
  });

  it("explainMetric resolves metric -> scenario -> certificate -> evidence contributions", () => {
    const explanation = explainMetric(project, "scenario:balance", "homes");
    expect(explanation.scenarioId).toBe("scenario:balance");
    expect(explanation.certificateId).toBe("scenario:balance:certificate");
    expect(explanation.certificateFreshness).toBe("CURRENT");
    expect(explanation.metricsSnapshot).toEqual([
      { metricId: "homes", label: "Homes", value: { value: 34, unit: "dwelling_units" } },
    ]);
    const contributed = JSON.stringify(explanation.contributions);
    expect(contributed).toContain(PARKING_CONSTRAINT_ID);
    expect(contributed).toContain("phl:src:S7@v1");
  });

  it("explaining an unknown metric or scenario fails loudly", () => {
    expect(() => explainMetric(project, "scenario:balance", "nonexistent")).toThrow(/metric not found/);
    expect(() => explainMetric(project, "scenario:missing", "homes")).toThrow(/scenario not found/);
  });

  it("missing dependency nodes produce an explicit missing marker, never an invented kind", () => {
    const broken = seedWithBalanceScenario();
    delete broken.nodes["phl:src:S7@v1"];
    const chain = getEvidenceChain(broken, PARKING_CONSTRAINT_ID);
    const flat = JSON.stringify(chain);
    expect(flat).toContain('"missing":true');
    expect(flat).toContain('"kind":null');
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
