import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Copilot } from "@/components/workspace/copilot";
import type { AcceptedPropertyRecord } from "@/lib/accepted-property";

/**
 * Issue #10 — the rail UI: honest states, structured confirmation outweighing
 * prose, and the confirm path going through POST /api/mission/state exactly
 * like the Mission Compiler (never a Copilot write path).
 */

const accepted: AcceptedPropertyRecord = {
  query: "7200 Roosevelt Blvd, Philadelphia, PA",
  matchedAddress: "7200 Roosevelt Blvd, Philadelphia, PA",
  acceptedAt: "2026-10-08T12:00:00.000Z",
  nodeCount: 42,
  eventCount: 42,
  revision: 3,
  structureCount: 1,
  zoningSummary: "RM-1",
  captures: [
    {
      provider: "pwd-parcels",
      mode: "FIXTURE",
      retrievedAt: "2026-10-08T12:00:00.000Z",
      hashPrefix: "abcd1234",
    },
  ],
};

const fakePair = {
  envelope: {
    session: { sessionId: "s1", confirmedParcelIds: ["778273000"] },
    signature: "env-sig",
  },
  receipt: { payload: { projectId: "gis:778273000" }, signature: "rcpt-sig" },
};

function storePair() {
  window.sessionStorage.setItem(
    "acrevia.accepted-session",
    JSON.stringify(fakePair),
  );
  window.sessionStorage.removeItem("acrevia.mission-log");
}

const proposalTurn = {
  status: "ok",
  reply:
    "Proposed: lower the Sunday parking minimum from 110 spaces to 90 spaces.",
  toolRuns: [
    {
      tool: "get_project_context",
      ok: true,
      summary: "project context: 3 current scenarios",
      args: {},
    },
    {
      tool: "propose_mission_change",
      ok: true,
      summary:
        "mission change proposed (awaits user confirmation; state unchanged)",
      args: {},
    },
  ],
  proposal: {
    proposalId: "mission:min-sunday-parking",
    label: "SUNDAY PARKING",
    detail: "Minimum 90 spaces",
    intentText: "Keep at least 90 Sunday parking spaces.",
    normalized: { type: "min-parking", spaces: { value: 90, unit: "spaces" } },
    hardOrSoft: "hard",
    current: {
      id: "mission:min-sunday-parking",
      summary: "at least 110 Sunday parking spaces",
    },
  },
  board: null,
  grounding: {
    checked: true,
    ok: true,
    violations: [],
    replacedWithFacts: false,
  },
};

beforeEach(() => {
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("Copilot rail", () => {
  it("stays honest without an accepted property — composer disabled, no fake chat", async () => {
    render(<Copilot accepted={null} />);
    await userEvent.click(screen.getByRole("button", { name: /copilot/i }));
    expect(screen.getByTestId("copilot-composer-input")).toBeDisabled();
    expect(
      screen.getByText(/resolve and accept a property/i),
    ).toBeInTheDocument();
  });

  it("renders tool chips and a structured proposal; Cancel changes no state", async () => {
    storePair();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(proposalTurn), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<Copilot accepted={accepted} />);
    await userEvent.click(screen.getByRole("button", { name: /copilot/i }));
    await userEvent.type(
      screen.getByTestId("copilot-composer-input"),
      "Keep at least 90 Sunday parking spaces.",
    );
    await userEvent.click(screen.getByTestId("copilot-send"));

    await waitFor(() => {
      expect(screen.getByTestId("copilot-proposal")).toBeInTheDocument();
    });
    const card = within(screen.getByTestId("copilot-proposal"));
    expect(
      card.getByText(/at least 110 Sunday parking spaces/i),
    ).toBeInTheDocument();
    // "90" appears both as the PROPOSED value and inside the quoted intent.
    expect(
      card.getAllByText(/at least 90 Sunday parking spaces/i).length,
    ).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByTestId("copilot-proposal-cancel"));
    expect(
      screen.getByText(/cancelled — no project state was changed/i),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem("acrevia.mission-log")).toBeNull();
  });

  it("confirm applies through POST /api/mission/state and persists the command log", async () => {
    storePair();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(proposalTurn), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            projectId: "gis:778273000",
            revision: 9,
            missionConstraints: [],
          }),
          {
            status: 200,
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<Copilot accepted={accepted} />);
    await userEvent.click(screen.getByRole("button", { name: /copilot/i }));
    await userEvent.type(
      screen.getByTestId("copilot-composer-input"),
      "Keep at least 90 Sunday parking spaces.",
    );
    await userEvent.click(screen.getByTestId("copilot-send"));
    await waitFor(() => {
      expect(
        screen.getByTestId("copilot-proposal-confirm"),
      ).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId("copilot-proposal-confirm"));
    await waitFor(() => {
      expect(
        screen.getByText(/applied — project revision 9/i),
      ).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const missionCall = fetchMock.mock.calls[1];
    expect(missionCall[0]).toBe("/api/mission/state");
    const body = JSON.parse(missionCall[1].body as string) as {
      commands: Array<{
        kind: string;
        input: { id: string; normalized: { spaces: { value: number } } };
      }>;
    };
    expect(body.commands).toHaveLength(1);
    expect(body.commands[0].kind).toBe("confirm");
    expect(body.commands[0].input.id).toBe("mission:min-sunday-parking");
    expect(body.commands[0].input.normalized.spaces.value).toBe(90);
    const stored = JSON.parse(
      window.sessionStorage.getItem("acrevia.mission-log") ?? "null",
    );
    expect(stored.commands).toHaveLength(1);
    expect(stored.projectId).toBe("gis:778273000");
  });

  it("shows the honest ai-unavailable state without canned answers", async () => {
    storePair();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "ai-unavailable",
            reason:
              "Copilot AI is not configured on this server. Set ACREVIA_AI_BASE_URL, ACREVIA_AI_API_KEY, ACREVIA_AI_MODEL.",
          }),
          { status: 200 },
        ),
      ),
    );
    render(<Copilot accepted={accepted} />);
    await userEvent.click(screen.getByRole("button", { name: /copilot/i }));
    await userEvent.type(
      screen.getByTestId("copilot-composer-input"),
      "What can we build?",
    );
    await userEvent.click(screen.getByTestId("copilot-send"));
    await waitFor(() => {
      expect(
        screen.getByText(/ai is not configured on this server/i),
      ).toBeInTheDocument();
    });
  });
});
