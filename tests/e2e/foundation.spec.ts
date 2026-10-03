import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const address = "12 St. Mark’s & Main #2";
test("address to workspace, navigation, reload and Copilot keyboard behavior", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Your land couldbecome homes.",
  );
  await expect(
    page.getByText("Illustration only · not a feasibility result"),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.evaluate(() => innerWidth),
  );
  await page.screenshot({
    path: `test-results/${test.info().project.name}-landing.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Explore the workspace" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Enter a church address",
  );
  await page
    .getByRole("textbox", { name: "Start with your church address" })
    .fill(address);
  await page.getByRole("button", { name: "Explore the workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Site", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("address")).toBe(address);
  for (const name of [
    "Portfolio",
    "Scenarios",
    "Capital",
    "Council",
    "Evidence",
    "Site",
  ]) {
    await page
      .getByRole("navigation", { name: "Workspace" })
      .getByRole("link", { name, exact: true })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByRole("link", { name, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(new URL(page.url()).searchParams.get("address")).toBe(address);
  }
  await page.reload();
  await expect(
    page.getByText("Address entered · not resolved or verified"),
  ).toBeVisible();
  await expect(page.getByText("No sources checked")).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.evaluate(() => innerWidth),
  );
  await page.screenshot({
    path: `test-results/${test.info().project.name}-workspace.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Copilot", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Project Copilot" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("textbox", { name: "Message Copilot" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Close Copilot" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Close Copilot" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Copilot", exact: true }),
  ).toBeFocused();
  expect(errors).toEqual([]);
});
test("accessible landing, empty workspace and Copilot", async ({ page }) => {
  await page.goto("/");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto("/workspace?view=unknown");
  await expect(
    page.getByRole("heading", { name: "Site", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Your next chapter")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Copilot", exact: true }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("malformed address and unknown route have recovery paths", async ({
  page,
}) => {
  await page.goto(`/workspace?address=${"x".repeat(241)}`);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "240 characters or fewer",
  );
  await expect(
    page.getByRole("link", { name: "Enter a church address" }),
  ).toHaveAttribute("href", "/");
  const response = await page.goto("/missing-page");
  expect(response?.status()).toBe(404);
  await page.getByRole("link", { name: "Return to Acrevia" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Your land could",
  );
});
