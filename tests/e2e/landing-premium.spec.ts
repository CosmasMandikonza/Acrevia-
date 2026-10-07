import { expect, test } from "@playwright/test";

/**
 * Issue #15 — premium landing pass (landing slice only).
 *
 * Covers the real address contract (valid / invalid / keyboard), address CTA
 * above the fold, the illustrative study sheet's staged states, reduced-motion
 * behavior, mobile layout integrity, and honesty language (no fabricated
 * feasibility results).
 *
 * The config's default baseURL points at the shared dev port; local runs on
 * this machine use LANDING_E2E_BASE_URL to target a worktree-isolated server
 * because port 3000 may host another session's build.
 */

const baseURL = process.env.LANDING_E2E_BASE_URL ?? "http://127.0.0.1:3000";

test.use({ baseURL });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Your land could become homes.",
  );
});

test("hero communicates the product thesis and the address is the primary CTA above the fold", async ({
  page,
}) => {
  await expect(page.getByText("Know what’s possible")).toBeVisible();

  const input = page.getByTestId("hero-address-input");
  await expect(input).toBeVisible();
  const box = await input.boundingBox();
  expect(box).not.toBeNull();
  // Above the fold on the judge laptop (1512x982) and standard 1440x900.
  expect(box!.y).toBeLessThan(760);

  const button = page.getByTestId("hero-address-submit");
  await expect(button).toBeVisible();

  // The sheet is the spatial protagonist of the hero and stays illustrative.
  const sheet = page.getByTestId("hero-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Illustrative study");
  await expect(
    page.getByText("Acrevia doesn’t generate an image of what might happen here."),
  ).toBeVisible();
});

test("study sheet stages SITE, EVIDENCE, POSSIBILITY end in their final state", async ({
  page,
}) => {
  for (const stage of ["site", "evidence", "possibility"]) {
    const label = page.getByTestId(`sheet-stage-${stage}`);
    await expect(label).toBeVisible();
    await expect(label).toHaveText(/SITE|EVIDENCE|POSSIBILITY/);
  }
  // All staged geometry settles (animation fill-mode both) into full opacity.
  await page.waitForTimeout(2600);
  const massingOpacity = await page
    .getByTestId("sheet-massing")
    .evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(massingOpacity)).toBeCloseTo(1, 1);
});

test("valid address navigates to the workspace with the address query", async ({
  page,
}) => {
  const input = page.getByTestId("hero-address-input");
  await input.fill("7200 Roosevelt Blvd, Philadelphia, PA");
  await page.getByTestId("hero-address-submit").click();
  await page.waitForURL(
    (url) =>
      url.pathname === "/workspace" &&
      url.searchParams.get("address") === "7200 Roosevelt Blvd, Philadelphia, PA",
  );
  await expect(page.getByRole("heading", { name: /.*/ }).first()).toBeVisible();
});

test("empty address shows the shared validation error and stays on the landing", async ({
  page,
}) => {
  await page.getByTestId("hero-address-submit").click();
  await expect(page.locator("#hero-address-error")).toContainText(
    "Enter a church address to continue.",
  );
  await expect(page).toHaveURL(/\/$/);
});

test("keyboard: input is reachable, focus-visible, and Enter submits the real flow", async ({
  page,
}) => {
  const input = page.getByTestId("hero-address-input");
  await input.focus();
  await expect(input).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#hero-address-error")).toContainText(
    "Enter a church address to continue.",
  );
  await input.fill("1200 N Broad St, Philadelphia, PA");
  await page.keyboard.press("Enter");
  await page.waitForURL(
    (url) =>
      url.pathname === "/workspace" &&
      url.searchParams.get("address") === "1200 N Broad St, Philadelphia, PA",
  );
});

test("reduced motion leaves the study sheet fully rendered without staging", async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  // With animations disabled globally, staged groups render at once.
  const group = page.getByTestId("sheet-massing");
  await expect(group).toBeVisible();
  expect(Number(await group.evaluate((el) => getComputedStyle(el).opacity))).toBeCloseTo(
    1,
    1,
  );
  await context.close();
});

test("no fabricated feasibility numbers appear on the landing", async ({ page }) => {
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/\b\d+\s+homes (are )?feasible/i);
  expect(text).not.toMatch(/\d+\s+parking (spaces )?(fit|fits)/i);
  expect(text).not.toMatch(/verified legal envelope/i);
});

test("mobile hero stays an editorial property entry without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const input = page.getByTestId("hero-address-input");
  await expect(input).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByTestId("hero-address-submit")).toBeVisible();
});
