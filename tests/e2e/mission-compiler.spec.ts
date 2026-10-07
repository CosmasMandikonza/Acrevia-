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
  // No proposal wrote canonical state yet (the committed base revision is
  // whatever the acceptance produced — live captures vary it).
  expect(await revisionOf(page)).toBeGreaterThanOrEqual(1);
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
  // CANONICAL STRUCTURE: the preserve rule references the actual
  // gis:structure:* Development Graph node, not a provider id.
  await expect(
    mission.locator('[data-constraint-id^="mission:preserve:gis:structure:"]'),
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

test("mission state never leaks from Property A onto Property B", async ({ page }) => {
  test.setTimeout(300_000); // two full LIVE flows, first-time layers on a cold server
  const ADDRESS_B = "1401 John F Kennedy Blvd, Philadelphia, PA";

  // Property A: accept and confirm all three canonical mission rules.
  const missionA = await resolveAndAccept(page);
  await missionA.getByLabel("DESCRIBE IT IN A SENTENCE").fill(CANONICAL_SENTENCE);
  await missionA.getByRole("button", { name: "Interpret" }).click();
  await expect(missionA.getByText("WHAT ACREVIA UNDERSTOOD")).toBeVisible({ timeout: 10_000 });
  for (let i = 1; i <= 3; i += 1) {
    await missionA.getByRole("button", { name: "Confirm — must keep" }).nth(0).click();
    // Wait for THIS confirmation to reach canonical state before the next.
    await expect(missionA.locator("[data-constraint-id]")).toHaveCount(i, { timeout: 15_000 });
  }

  // Change the Site field to Property B, resolve (this address requires the
  // parcel-candidates ambiguity flow), and accept B.
  await page.fill("#site-address", ADDRESS_B);
  await page.getByRole("button", { name: /resolve property/i }).click();
  await expect(page.getByRole("heading", { name: /select yours/i })).toBeVisible({
    timeout: 60_000,
  });
  const parcelOptions = page.locator("section h3 + ul button");
  const preferred = parcelOptions.filter({ hasText: /kennedy/i });
  await (await preferred.count() > 0 ? preferred.first() : parcelOptions.first()).click();
  await page.getByRole("button", { name: /^confirm \d* ?parcel/i }).click();
  // First resolution of a new address on a cold server fetches every LIVE
  // layer from scratch — allow generous time.
  await expect(page.getByRole("heading", { name: /confirm this property/i })).toBeVisible({
    timeout: 150_000,
  });
  await page.getByRole("button", { name: /accept this property/i }).click();
  await expect(page.getByRole("heading", { name: /property accepted/i })).toBeVisible({
    timeout: 30_000,
  });

  // ISOLATION: Property B's Mission Compiler starts with ZERO of A's rules.
  const missionB = page.locator('section[aria-label="Mission Compiler"]');
  await expect(missionB).toBeVisible({ timeout: 15_000 });
  await expect(missionB.getByText("No mission rules yet.")).toBeVisible({ timeout: 15_000 });
  await expect(missionB.locator("[data-constraint-id]")).toHaveCount(0);
  await expect(missionB.getByText(/· MUST KEEP/, { exact: false })).toHaveCount(0);
  // No structure on B carries A's mission protection.
  await expect(
    page.locator('[data-testid="structure-geometry"][data-mission-protected="yes"]'),
  ).toHaveCount(0);
  await page.screenshot({ path: `${REVIEWS}/mission-5-cross-property-isolation.png` });
});

test("rapid confirmations cannot lose, duplicate, or reorder mission rules", async ({ page }) => {
  test.slow();
  const mission = await resolveAndAccept(page);
  await mission.getByLabel("DESCRIBE IT IN A SENTENCE").fill(
    "Keep at least 110 Sunday parking spaces. We are not selling the land.",
  );
  await mission.getByRole("button", { name: "Interpret" }).click();
  await expect(mission.getByText("PROPOSED · SUNDAY PARKING", { exact: false })).toBeVisible({
    timeout: 10_000,
  });
  await expect(mission.getByText("PROPOSED · OWNERSHIP", { exact: false })).toBeVisible();

  // Fire both confirmations with no await between clicks — the second lands
  // while the first canonical mutation is still in flight.
  const confirms = mission.getByRole("button", { name: "Confirm — must keep" });
  await confirms.first().click();
  await confirms.first().click();

  // The serialized command queue must land BOTH rules exactly once, in order.
  await expect(mission.locator("[data-constraint-id]")).toHaveCount(2, { timeout: 20_000 });
  await expect(mission.getByText("SUNDAY PARKING · MUST KEEP", { exact: false })).toBeVisible();
  await expect(mission.getByText("OWNERSHIP · MUST KEEP", { exact: false })).toBeVisible();
  await expect(mission.locator("[data-constraint-id='mission:min-sunday-parking']")).toHaveCount(1);
  await expect(mission.locator("[data-constraint-id='mission:retain-ownership']")).toHaveCount(1);

  // Canonical project and persisted log agree: reload reconstructs both.
  await page.reload({ waitUntil: "domcontentloaded" });
  const restored = page.locator('section[aria-label="Mission Compiler"]');
  await expect(restored.locator("[data-constraint-id]")).toHaveCount(2, { timeout: 20_000 });
  await expect(restored.getByText("SUNDAY PARKING · MUST KEEP", { exact: false })).toBeVisible();
  await expect(restored.getByText("OWNERSHIP · MUST KEEP", { exact: false })).toBeVisible();
});

test("direct controls validate visibly instead of silently doing nothing", async ({ page }) => {
  test.slow();
  const mission = await resolveAndAccept(page);
  await mission.getByText("Or set a rule directly").click();

  // Invalid parking value → a visible explanation, no proposal.
  await mission.getByLabel("Sunday parking — at least").fill("0");
  await mission.getByRole("button", { name: "Propose" }).first().click();
  await expect(
    mission.getByText("Sunday parking must be a whole number of spaces, at least 1."),
  ).toBeVisible();
  await expect(mission.getByText("PROPOSED · SUNDAY PARKING", { exact: false })).toHaveCount(0);

  // Corrected value → the proposal appears.
  await mission.getByLabel("Sunday parking — at least").fill("110");
  await mission.getByRole("button", { name: "Propose" }).first().click();
  await expect(mission.getByText("PROPOSED · SUNDAY PARKING", { exact: false })).toBeVisible();
  await expect(mission.getByText("Minimum 110 spaces")).toBeVisible();
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
