import { test, expect, type Page } from "@playwright/test";

/**
 * Issue #11 — Proof, end to end on the canonical Calvary property.
 *
 * resolve → accept → confirm the canonical mission rules → Evidence: the
 * trusted Proof projection renders the chain
 * SOURCE → CLAIM → REGULATION → CONSTRAINT → RESULT → SCENARIO → CERTIFICATE
 * with LAW and APPLIES HERE kept separate, MACHINE CHECKED as a presentation
 * label, assumptions and mission rules visibly distinct from law, the honest
 * conflict state, all 14 benchmark expert questions, a downloadable diligence
 * summary, and fail-closed deep links. No number on this page may lack
 * provenance.
 */

const BASE = process.env.ACREVIA_E2E_BASE ?? "http://localhost:3121";
const CANONICAL = `${BASE}/workspace?address=7200%20Roosevelt%20Blvd%2C%20Philadelphia%2C%20PA&view=site`;
const CANONICAL_SENTENCE =
  "Keep the sanctuary. Keep at least 110 Sunday parking spaces. We are not selling the land.";
const REVIEWS = "docs/reviews/issue-11";

async function resolveAndAccept(page: Page) {
  test.setTimeout(300_000);
  await page.goto(CANONICAL);
  await page.getByRole("button", { name: /resolve property/i }).click();
  await expect(page.getByRole("heading", { name: /confirm this property/i })).toBeVisible({
    timeout: 150_000,
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if ((await page.locator('p[role="alert"]').count()) > 0) {
      await page.getByRole("button", { name: /try again/i }).click();
      await expect(page.getByRole("heading", { name: /confirm this property/i })).toBeVisible({ timeout: 150_000 });
    } else break;
  }
  await page.getByRole("button", { name: /accept this property/i }).click();
  await expect(page.getByRole("heading", { name: /property accepted/i })).toBeVisible({ timeout: 30_000 });
  const mission = page.locator('section[aria-label="Mission Compiler"]');
  await expect(mission).toBeVisible({ timeout: 15_000 });
  return mission;
}

async function confirmCanonicalMissions(page: Page) {
  const mission = await resolveAndAccept(page);
  await mission.getByLabel("DESCRIBE IT IN A SENTENCE").fill(CANONICAL_SENTENCE);
  await mission.getByRole("button", { name: "Interpret" }).click();
  await expect(mission.getByText("WHAT ACREVIA UNDERSTOOD")).toBeVisible({ timeout: 10_000 });
  await mission.getByRole("button", { name: "Confirm — must keep" }).nth(0).click();
  await expect(mission.getByText("PRESERVE · MUST KEEP", { exact: false })).toBeVisible({ timeout: 15_000 });
  await mission.getByRole("button", { name: "Confirm — must keep" }).nth(0).click();
  await expect(mission.getByText("SUNDAY PARKING · MUST KEEP", { exact: false })).toBeVisible({ timeout: 15_000 });
  await mission.getByRole("button", { name: "Confirm — must keep" }).nth(0).click();
  await expect(mission.getByText("OWNERSHIP · MUST KEEP", { exact: false })).toBeVisible({ timeout: 15_000 });
}

async function openEvidence(page: Page) {
  await page.getByRole("link", { name: /^Evidence$/ }).click();
  const ledger = page.locator('section[aria-label="Evidence ledger"]');
  await expect(ledger.getByTestId("proof-chain")).toBeVisible({ timeout: 60_000 });
  return ledger;
}

test.describe.configure({ mode: "serial" });

test("canonical proof journey: chain, certificate, law vs applies here, assumptions, expert queue, diligence export", async ({
  page,
}) => {
  test.slow();
  await confirmCanonicalMissions(page);
  const ledger = await openEvidence(page);

  // The projection header carries identity + honest counts.
  await expect(ledger.getByText(/Sources\s+\d+/).first()).toBeVisible();

  // Scenario selector with CURRENT certificates.
  const options = ledger.getByTestId("proof-scenario-option");
  await expect(options.first()).toBeVisible();
  expect(await options.count()).toBeGreaterThanOrEqual(3);
  const freshness = ledger.getByTestId("proof-certificate-freshness");
  for (let i = 0; i < await freshness.count(); i += 1) {
    await expect(freshness.nth(i)).toHaveText("CURRENT");
  }

  // MACHINE CHECKED appears as a presentation label on deterministic results.
  await expect(ledger.getByTestId("machine-checked").first()).toBeVisible();

  // Click the height result — the "38 ft" trust moment.
  const heightRow = ledger.locator("[data-constraint-id='phl:constraint:height:max:principal']").first();
  await expect(heightRow).toBeVisible();
  await heightRow.click();
  const inspector = page.locator('aside[aria-label="Proof inspector"]');
  await expect(inspector.getByTestId("inspector-result")).toBeVisible();
  await expect(inspector.getByText(/MACHINE CHECKED/)).toBeVisible();
  await expect(inspector.getByText("Method", { exact: true })).toBeVisible();

  // LAW and APPLIES HERE stay two separate strands inside the result.
  await expect(inspector.getByTestId("law-strand").first()).toContainText(/LAW/);
  await expect(inspector.getByTestId("law-strand").first()).toContainText(/Quick Guide/);
  await expect(inspector.getByTestId("applies-here-strand").first()).toContainText(/APPLIES HERE/);
  await expect(inspector.getByTestId("applies-here-strand").first()).toContainText(/RM-1/);

  // Inspect the certificate: current, pinned dependencies, expandable details.
  await ledger.getByText(/What facts made this scenario true/).first().click();
  await expect(inspector.getByTestId("inspector-certificate")).toBeVisible();
  await expect(inspector.getByText("CURRENT", { exact: false })).toBeVisible();
  await expect(inspector.getByText(/pinned dependency kinds/i)).toBeVisible();
  await inspector.getByRole("button", { name: /Show technical details/ }).click();
  await expect(inspector.locator("li", { hasText: /r\d+ ·/ }).first()).toBeVisible();

  // Assumptions are explicit and never styled as law.
  await expect(ledger.getByTestId("assumption-row").first()).toBeVisible();
  await expect(ledger.getByText("ASSUMPTIONS — MODEL-DECLARED, NOT LAW")).toBeVisible();
  await expect(ledger.getByText("350 sq_ft").first()).toBeVisible();

  // Mission rules display as USER DECLARED, never as sourced facts.
  await expect(ledger.getByText("MISSION RULES — USER DECLARED, NOT SOURCED FACTS")).toBeVisible();
  await expect(ledger.getByText(/USER DECLARED · CONFIRMED · HARD/).first()).toBeVisible();

  // Conflict compare view: honest empty state (no unresolved conflicts in the
  // captured corpus) — the view exists and never invents a winner.
  await expect(ledger.getByTestId("conflict-compare")).toBeVisible();
  await expect(ledger.getByText(/No unresolved conflicts among the captured sources/)).toBeVisible();

  // The expert queue shows all 14 benchmark open questions plus computation
  // questions, visually distinct lanes.
  const expertItems = ledger.getByTestId("expert-review-item");
  await expect(expertItems.first()).toBeVisible({ timeout: 20_000 });
  expect(await expertItems.count()).toBe(14);
  await expect(ledger.getByText(/PROFESSIONAL JUDGMENT — GRAPH EXPERT REVIEWS/)).toBeVisible();
  await expect(ledger.getByText(/UNRESOLVED COMPUTATION — SCENARIO CHECKS/)).toBeVisible();
  await expect(ledger.getByTestId("computation-question").first()).toBeVisible();

  // The compiled-law surface from #5 keeps working inside the new workspace.
  const compiledLaw = ledger.locator('section[aria-label="Compiled law"]');
  await expect(compiledLaw).toBeVisible();
  await expect(compiledLaw.getByTestId("compiled-law-rule").first()).toBeVisible();

  // Diligence summary export: deterministic markdown derived from the DTO.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    ledger.getByTestId("diligence-download").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^acrevia-diligence-.+\.md$/);

  await page.screenshot({ path: `${REVIEWS}/proof-chain.png`, fullPage: false });
  await page.screenshot({ path: `${REVIEWS}/certificate-current.png`, fullPage: true });
  await inspector.getByRole("button", { name: /Hide technical details/ }).click();
});

test("deep link selects scenario + certificate + focus from real graph ids", async ({ page }) => {
  test.slow();
  // Re-establish the accepted session in this test's own flow.
  await resolveAndAccept(page);
  const ledger = await openEvidence(page);

  // Harvest real ids from the rendered projection.
  const scenarioId = (await ledger.getByTestId("proof-scenario-option").first().getAttribute("data-node-id"))!;
  expect(scenarioId).toMatch(/^scenario:solver:/);
  const certificateId = `${scenarioId}:certificate`;
  const focusId = "phl:constraint:height:max:principal";

  // Same tab navigation keeps sessionStorage (the accepted pair).
  await page.goto(
    `${BASE}/workspace?address=7200%20Roosevelt%20Blvd%2C%20Philadelphia%2C%20PA&view=evidence` +
      `&focus=${encodeURIComponent(focusId)}&scenario=${encodeURIComponent(scenarioId)}` +
      `&certificate=${encodeURIComponent(certificateId)}`,
  );
  const deepLedger = page.locator('section[aria-label="Evidence ledger"]');
  await expect(deepLedger.getByTestId("proof-chain")).toBeVisible({ timeout: 60_000 });

  // The scenario is selected; the certificate inspector is open; the focused
  // constraint's result row carries the focus ring.
  await expect(
    deepLedger.locator(`[data-testid="proof-scenario-option"][data-node-id="${scenarioId}"]`),
  ).toBeVisible();
  await expect(
    page.locator('aside[aria-label="Proof inspector"]').getByTestId("inspector-certificate"),
  ).toBeVisible();
  const focusedRow = deepLedger.locator(`[data-constraint-id="${focusId}"]`).first();
  await expect(focusedRow).toHaveAttribute("data-focused", "true");
  await expect(deepLedger.getByTestId("focus-invalid-notice")).toHaveCount(0);

  await page.screenshot({ path: `${REVIEWS}/deep-link-focus.png`, fullPage: false });
});

test("foreign and fabricated deep-link ids fail closed — another project's data never renders", async ({
  page,
}) => {
  test.slow();
  await resolveAndAccept(page);
  await page.goto(
    `${BASE}/workspace?address=7200%20Roosevelt%20Blvd%2C%20Philadelphia%2C%20PA&view=evidence` +
      `&focus=${encodeURIComponent("gis:parcel:999999999")}&scenario=${encodeURIComponent("scenario:solver:other:project")}`,
  );
  const ledger = page.locator('section[aria-label="Evidence ledger"]');
  await expect(ledger.getByTestId("proof-chain")).toBeVisible({ timeout: 60_000 });
  const notice = ledger.getByTestId("focus-invalid-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("not part of this current project");
  await expect(notice).toContainText("gis:parcel:999999999");
  await expect(notice).toContainText("scenario:solver:other:project");

  // A certificate id the current rebuild cannot reproduce → STALE / RECOMPUTE.
  await page.goto(
    `${BASE}/workspace?address=7200%20Roosevelt%20Blvd%2C%20Philadelphia%2C%20PA&view=evidence` +
      `&certificate=${encodeURIComponent("scenario:solver:housing-max:deadbeef:certificate")}`,
  );
  const staleLedger = page.locator('section[aria-label="Evidence ledger"]');
  await expect(staleLedger.getByTestId("proof-stale-banner")).toBeVisible({ timeout: 60_000 });
  await expect(staleLedger.getByTestId("proof-stale-banner")).toContainText("STALE / RECOMPUTE");
  await expect(staleLedger.getByTestId("proof-stale-banner")).toContainText("earlier project state");

  await page.screenshot({ path: `${REVIEWS}/stale-proof.png`, fullPage: false });
});
