// One-shot Copilot rail browser smoke (issue #10). Evidence surface — no map,
// no WebGL, no Forge. Verifies the rail mounts, opens, and renders its honest
// empty state without console errors.
import { chromium } from "@playwright/test";

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3131";
const url = `${BASE}/workspace?address=${encodeURIComponent("7200 Roosevelt Blvd, Philadelphia, PA")}&view=evidence`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
const button = page.getByRole("button", { name: /copilot/i });
await button.waitFor({ state: "visible", timeout: 60000 });
await page.waitForTimeout(1500); // allow hydration to finish
await button.click();
await page.waitForSelector('[data-testid="copilot-rail"]', { timeout: 30000 });

const rail = page.locator('[data-testid="copilot-rail"]');
const subtitle = await rail.locator(".copilot-subtitle").innerText();
const composerDisabled = await page.locator('[data-testid="copilot-composer-input"]').isDisabled();
const emptyState = await rail.locator(".copilot-empty").innerText();

await page.screenshot({ path: "test-results/copilot-smoke-rail.png", fullPage: false });
await rail.screenshot({ path: "test-results/copilot-smoke-rail-only.png" });

console.log("SUBTITLE:", subtitle);
console.log("COMPOSER_DISABLED:", composerDisabled);
console.log("EMPTY_STATE:", emptyState.replace(/\s+/g, " ").slice(0, 140));
console.log("PAGE_ERRORS:", errors.length === 0 ? "none" : errors.join(" | ").slice(0, 500));
await browser.close();
