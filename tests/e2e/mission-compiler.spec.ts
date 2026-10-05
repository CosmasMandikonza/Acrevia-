import { test, expect, type Page } from "@playwright/test";

/**
 * Mission Compiler journey (issue #6) on the canonical Calvary property.
 *
 * resolve → accept → "What must this property protect?" → one sentence →
 * inspectable proposals → explicit confirmation → canonical Development
 * Graph rules (revision-visible) → reload continuity. Nothing becomes active
 * without confirmation; ambiguity and contradiction stay visible.
 */

const BASE = process.env.ACREVIA_E2E_BASE ?? "http://localhost:3121";
const CANONICAL = `${BASE}/workspace?address=7200%20Roosevelt%20Blvd%2C%20Philadelphia%2C%20PA&view=site`;
const CANONICAL_SENTENCE =
  "Keep the sanctuary. Keep at least 110 Sunday parking spaces. We don't want to sell the land.";
const REVIEWS = "docs/reviews/issue-6";

async function resolveAndAccept(page: Page) {
  await page.goto(CANONICAL);
  await page.getByRole("button", { name: /resolve property/i }).click();
  await expect(page.getByRole("heading", { name: /confirm this property/i })).toBeVisible({
    timeout: 60_000,
  });
  if ((await page.getByText(/zoning layer unavailable/i).count()) > 0) {
    await page.getByRole("button", { name: /resolve property/i }).click();
  }
  await page.getByRole("button", { name: /accept this property/i }).click();
  await expect(page.getByRole("heading", { name: /property accepted/i })).toBeVisible({
    timeout: 30_000,
  });
  const mission = page.locator('section[aria-label="Mission Compiler"]');
  await expect(mission).toBeVisible({ timeout: 15_000 });
  return mission;
}

async function revisionOf(page: Page): Promise<number> {
  const text = await page
    .locator('section[aria-label="Mission Compiler"]')
    .getByText(/^rev \d+ ·/)
    .first()
    .textContent();
  return Number(/rev (\d+)/.exec(text ?? "")?.[1] ?? 0);
}

test.describe.configure({ mode: "serial" });

test("canonical mission sentence becomes confirmed, revision-visible project rules", async ({
  page,
}) => {
  test.slow();
  const mission = await resolveAndAccept(page);
  await page.screenshot({ path: `${REVIEWS}/mission-1-onboarding.png` });

  // Interpret the canonical sentence.
  await mission.getByLabel("DESCRIBE IT IN A SENTENCE").fill(CANONICAL_SENTENCE);
  await mission.getByRole("button", { name: "Interpret" }).click();

  // Exactly what Acrevia understood, labeled, before anything is active.
  await expect(mission.getByText("WHAT ACREVIA UNDERSTOOD")).toBeVisible({ timeout: 10_000 });
  await expect(mission.getByText("PROPOSED · SUNDAY PARKING", { exact: false })).toBeVisible();
  await expect(mission.getByText("PROPOSED · PRESERVE", { exact: false })).toBeVisible();
  await expect(mission.getByText("PROPOSED · OWNERSHIP", { exact: false })).toBeVisible();
  await expect(mission.getByText("Minimum 110 spaces")).toBeVisible();
  // No proposal wrote canonical state yet.
  expect(await revisionOf(page)).toBeGreaterThanOrEqual(23);
  const revisionBefore = await revisionOf(page);
  await expect(mission.getByText("No mission rules yet.")).toBeVisible();
  await page.screenshot({ path: `${REVIEWS}/mission-2-interpreted-draft.png` });

  // Confirm all three — each becomes a real MissionConstraint. The parser
  // emits clause order: PRESERVE, SUNDAY PARKING, OWNERSHIP.
  await mission.getByRole("button", { name: "Confirm — must keep" }).nth(0).click();
  await expect(mission.getByText("PRESERVE · MUST KEEP", { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  await mission.getByRole("button", { name: "Confirm — must keep" }).nth(0).click();
  await expect(mission.getByText("SUNDAY PARKING · MUST KEEP", { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  await mission.getByRole("button", { name: "Confirm — must keep" }).nth(0).click();
  await expect(mission.getByText("OWNERSHIP · MUST KEEP", { exact: false })).toBeVisible({
    timeout: 15_000,
  });

  // The sanctuary rule is bound to the real resolved church footprint.
  await expect(
    page.locator('[data-testid="structure-geometry"][data-mission-protected="yes"]'),
  ).toHaveCount(1);
  expect(await revisionOf(page)).toBeGreaterThan(revisionBefore);
  await page.screenshot({ path: `${REVIEWS}/mission-3-confirmed.png` });

  // Edit Sunday parking 110 → 130 through the typed boundary; revision moves.
  await mission.getByRole("button", { name: "Edit value" }).first().click();
  await mission.getByLabel(/New value for SUNDAY PARKING/i).fill("130");
  await mission.getByRole("button", { name: "Save" }).click();
  await expect(mission.getByText("Minimum 130 spaces")).toBeVisible({ timeout: 15_000 });
  expect(await revisionOf(page)).toBeGreaterThan(revisionBefore);

  // Reload: canonical mission state reconstructs through the verified pair.
  await page.reload({ waitUntil: "domcontentloaded" });
  const restored = page.locator('section[aria-label="Mission Compiler"]');
  await expect(restored.getByText("Minimum 130 spaces")).toBeVisible({ timeout: 20_000 });
  await expect(restored.getByText("OWNERSHIP · MUST KEEP", { exact: false })).toBeVisible();
  await expect(
    page.locator('[data-testid="structure-geometry"][data-mission-protected="yes"]'),
  ).toHaveCount(1);
});

test("contradictions and vague language never silently activate", async ({ page }) => {
  test.slow();
  const mission = await resolveAndAccept(page);

  // Contradictory ownership language → conflict, no proposal.
  await mission.getByLabel("DESCRIBE IT IN A SENTENCE").fill(
    "We must retain ownership, but selling the property is okay.",
  );
  await mission.getByRole("button", { name: "Interpret" }).click();
  await expect(mission.getByText("CONFLICT")).toBeVisible({ timeout: 10_000 });
  await expect(mission.getByText("PROPOSED · OWNERSHIP", { exact: false })).toHaveCount(0);
  await page.screenshot({ path: `${REVIEWS}/mission-4-conflict.png` });

  // Vague parking → clarification, never an invented number.
  await mission.getByLabel("DESCRIBE IT IN A SENTENCE").fill("Parking is important.");
  await mission.getByRole("button", { name: "Interpret" }).click();
  await expect(mission.getByText("NEEDS CLARIFICATION")).toBeVisible({ timeout: 10_000 });
  await expect(mission.getByText("PROPOSED · SUNDAY PARKING", { exact: false })).toHaveCount(0);
  await expect(mission.getByText(/will not invent a parking number/i)).toBeVisible();

  // An unsupported goal stays honest.
  await mission.getByLabel("DESCRIBE IT IN A SENTENCE").fill("Prioritize affordable housing.");
  await mission.getByRole("button", { name: "Interpret" }).click();
  await expect(mission.getByText("NOT EXECUTABLE YET")).toBeVisible({ timeout: 10_000 });

  // A removed proposal never confirms.
  await mission.getByLabel("DESCRIBE IT IN A SENTENCE").fill(
    "Keep at least 40 Sunday parking spaces.",
  );
  await mission.getByRole("button", { name: "Interpret" }).click();
  await expect(mission.getByText("PROPOSED · SUNDAY PARKING", { exact: false })).toBeVisible();
  await mission.getByRole("button", { name: "Remove" }).first().click();
  await expect(mission.getByText("PROPOSED · SUNDAY PARKING", { exact: false })).toHaveCount(0);
  await expect(mission.getByText("No mission rules yet.")).toBeVisible();
});
