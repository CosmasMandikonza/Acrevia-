import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.ACREVIA_E2E_BASE ?? "http://127.0.0.1:3121";
const OUT = "test-results/forge";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=swiftshader", "--enable-webgl", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("CONSOLE ERROR:", msg.text().slice(0, 200));
});
page.on("pageerror", (err) => console.log("PAGE ERROR:", String(err).slice(0, 300)));

await page.goto(`${BASE}/forge-spike`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="forge-spike-root"][data-rendered="1"]', { timeout: 90000 });
await page.waitForSelector('[data-camera-settled="1"]', { timeout: 30000 });
await page.waitForTimeout(700);

async function moment(m) {
  await page.click(`[data-testid="moment-${m}"]`);
  await page.waitForFunction(
    (mm) => document.querySelector('[data-testid="forge-spike-root"]')?.getAttribute("data-moment") === mm,
    m,
  );
  await page.waitForTimeout(400);
}

async function camera(id) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.click(`[data-testid="camera-${id}"]`);
    try {
      await page.waitForFunction(
        (cid) => {
          const el = document.querySelector('[data-testid="forge-spike-root"]');
          return el?.getAttribute("data-camera-active") === cid && el?.getAttribute("data-camera-settled") === "1";
        },
        id,
        { timeout: 8000 },
      );
      break;
    } catch {
      // retry — a mid-render click can race the React state transition
    }
  }
  await page.waitForTimeout(300);
}

// Moments from the aerial camera
await camera("camera:aerial");
await moment("existing");
await page.screenshot({ path: `${OUT}/01-existing-aerial.png` });
await moment("legal");
await page.screenshot({ path: `${OUT}/02-legal-aerial.png` });
await moment("mission");
await page.screenshot({ path: `${OUT}/03-mission-aerial.png` });
await moment("scenario");
await page.screenshot({ path: `${OUT}/04-scenario-aerial.png` });

// Cameras in the scenario moment
await camera("camera:entry");
await page.screenshot({ path: `${OUT}/05-scenario-entry.png` });
await camera("camera:pedestrian");
await page.screenshot({ path: `${OUT}/06-scenario-pedestrian.png` });
await camera("camera:neighbor");
await page.screenshot({ path: `${OUT}/07-scenario-neighbor.png` });

// Refused scenario
await page.click('[data-testid="scenario-phl\\:scenario\\:optimistic-tower"]');
await page.waitForTimeout(300);
await camera("camera:aerial");
await page.screenshot({ path: `${OUT}/08-scenario-refused-aerial.png` });

// Selection card (click the legal envelope in legal moment)
await moment("legal");
await page.mouse.click(756, 300);
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/09-legal-selection.png` });

// Derivation drawer
await page.click("text=Derivation");
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/10-derivation.png` });

// FPS + build ms
const fps = await page.textContent('[data-testid="forge-fps"]').catch(() => null);
const buildMs = await page.textContent('[data-testid="forge-build-ms"]').catch(() => null);
console.log("FPS chip:", fps, "| build:", buildMs);

// Fallback plan view
await page.goto(`${BASE}/forge-spike?fallback=1`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="forge-fallback"]', { timeout: 30000 });
await page.click('[data-testid="moment-mission"]');
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/11-fallback-mission.png` });

await browser.close();
console.log("done ->", OUT);
