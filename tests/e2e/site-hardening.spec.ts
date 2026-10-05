import { test, expect, type Page } from "@playwright/test";

/**
 * Site browser hardening (feat/site-browser-hardening, PR #25).
 *
 * Covers the failure/restore behaviors discovered by interactive browser QA
 * and the session-restore trust invariant: sessionStorage is never a source
 * of verified truth. Restoring an accepted state requires BOTH server
 * attestations — the signed ResolutionEnvelope (authentic provider facts)
 * and the signed CommitReceipt (proof the atomic commit happened, carrying
 * the revision/node/event metadata) — verified together by
 * POST /api/gis/verify. Tampered or receipt-less storage is discarded and
 * never displayed; the forgeable acrevia:accepted DOM event is not listened to.
 *
 * Run against a running Acrevia server (default: local dev server on 3121):
 *   ACREVIA_E2E_BASE=http://localhost:3121 npx playwright test tests/e2e/site-hardening.spec.ts
 */

const BASE = process.env.ACREVIA_E2E_BASE ?? "http://localhost:3121";
const CANONICAL = `${BASE}/workspace?address=7200%20Roosevelt%20Blvd%2C%20Philadelphia%2C%20PA&view=site`;
const SESSION_KEY = "acrevia.accepted-session";
const LEGACY_RECORD_KEY = "acrevia.accepted-property";
const LEGACY_ENVELOPE_KEY = "acrevia.accepted-envelope";

// Each test drives a full LIVE resolution flow against public GIS providers;
// running them concurrently trips provider throttling and blurs failures.
test.describe.configure({ mode: "serial" });

async function resolveCanonical(page: Page) {
  await page.goto(CANONICAL);
  await page.getByRole("button", { name: /resolve property/i }).click();
  // Resolution completes with the pre-accept confirmation panel.
  await expect(page.getByRole("heading", { name: /confirm this property/i })).toBeVisible({
    timeout: 60_000,
  });
  // Public GIS layers occasionally fail transiently under load; the product
  // surfaces that honestly ("Zoning layer unavailable"). Retry once — as a
  // user would — so the suite anchors on a complete context.
  const zoningUnavailable = await page.getByText(/zoning layer unavailable/i).count();
  if (zoningUnavailable > 0) {
    await page.getByRole("button", { name: /resolve property/i }).click();
  }
  // Pre-accept context: zoning/structure facts render before acceptance.
  await expect(page.getByText(/RM-1/).first()).toBeVisible({ timeout: 60_000 });
}

async function acceptProperty(page: Page) {
  await page.getByRole("button", { name: /accept this property/i }).click();
  await expect(page.getByRole("heading", { name: /property accepted/i })).toBeVisible({
    timeout: 30_000,
  });
}

/** Read the stored { envelope, receipt } pair. */
function readStore(page: Page) {
  return page.evaluate((key) => window.sessionStorage.getItem(key), SESSION_KEY);
}

function writeStore(page: Page, value: string | null) {
  return page.evaluate(
    ({ key, value: v }) => {
      if (v === null) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, v);
    },
    { key: SESSION_KEY, value },
  );
}

async function expectNotAccepted(page: Page) {
  await expect(page.getByRole("heading", { name: /property accepted/i })).toHaveCount(0);
  await expect(page.locator(".toolbar-status")).toContainText(/ready to resolve/i);
}

async function expectStorageCleared(page: Page) {
  const storage = await page.evaluate(
    (keys) => keys.map((key) => window.sessionStorage.getItem(key)),
    [SESSION_KEY, LEGACY_RECORD_KEY, LEGACY_ENVELOPE_KEY],
  );
  expect(storage).toEqual([null, null, null]);
}

test("short-address failure is visible and actionable", async ({ page }) => {
  await page.goto(CANONICAL);
  await page.fill("#site-address", "7200 Roosevelt Blvd");
  await page.getByRole("button", { name: /resolve property/i }).click();

  // Next.js also mounts an empty route-announcer div[role=alert]; scope to the
  // resolution failure paragraph.
  const alert = page.locator('p[role="alert"]');
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(alert).toContainText(/no match in the public address registry/i);
  await expect(alert).toContainText(/add the city and state/i);
  await expect(alert.getByRole("button", { name: /try again/i })).toBeVisible();
  // No geometry was resolved, so none is displayed as fact.
  await expect(page.getByTestId("parcel-geometry")).toHaveCount(0);
});

test("double-click Accept commits exactly once", async ({ page }) => {
  await resolveCanonical(page);

  let commitPosts = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/gis/commit") && request.method() === "POST") {
      commitPosts += 1;
    }
  });

  await page.getByRole("button", { name: /accept this property/i }).click({ clickCount: 2 });
  await expect(page.getByRole("heading", { name: /property accepted/i })).toBeVisible({
    timeout: 30_000,
  });
  // Give any stray second commit a moment to fire before asserting the count.
  await page.waitForTimeout(1500);
  expect(commitPosts).toBe(1);
});

test("valid commit receipt restores the accepted state after reload", async ({ page }) => {
  test.slow(); // full LIVE flow + reload
  await resolveCanonical(page);
  await acceptProperty(page);
  await expect(page.getByText(/Calvary Memorial Church/i).first()).toBeVisible();

  // Stored state is the signed pair — envelope AND receipt.
  const stored = await readStore(page);
  expect(stored).toBeTruthy();
  const parsed = JSON.parse(stored!) as { envelope?: unknown; receipt?: { signature?: string } };
  expect(parsed.envelope).toBeDefined();
  expect(parsed.receipt?.signature).toMatch(/^[0-9a-f]{64}$/);

  await page.reload({ waitUntil: "domcontentloaded" });

  // The stored pair must pass server verification before any of this renders.
  await expect(page.getByRole("heading", { name: /property accepted/i })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/Calvary Memorial Church/i).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/RM-1/i).first()).toBeVisible();
  // Revision in the chip is derived from the verified receipt.
  await expect(page.locator(".toolbar-status")).toContainText(/revision \d+/);
  await expect(page.locator('section[aria-label="Evidence"] li')).not.toHaveCount(0);
});

test("tampered envelope (with valid receipt) is rejected and discarded on reload", async ({
  page,
}) => {
  await resolveCanonical(page);
  await acceptProperty(page);

  // Forge provider-derived facts inside the signed envelope.
  await page.evaluate(
    ({ key }) => {
      const stored = JSON.parse(window.sessionStorage.getItem(key) ?? "{}");
      stored.envelope.session.parcelContexts[0].zoningBase.district = "CA-999-TAMPERED";
      stored.envelope.session.parcelCandidates[0].ownerName = "TAMPERED OWNER LLC";
      stored.envelope.session.parcelCandidates[0].geometry = {
        type: "Polygon",
        coordinates: [
          [
            [-74.0, 40.0],
            [-74.001, 40.0],
            [-74.001, 40.001],
            [-74.0, 40.001],
            [-74.0, 40.0],
          ],
        ],
      };
      window.sessionStorage.setItem(key, JSON.stringify(stored));
    },
    { key: SESSION_KEY },
  );

  const verifyFailed = page.waitForResponse(
    (response) => response.url().includes("/api/gis/verify") && response.status() === 400,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await verifyFailed;

  await page.waitForTimeout(1000);
  await expectNotAccepted(page);
  await expect(page.getByText(/TAMPERED OWNER LLC/i)).toHaveCount(0);
  await expect(page.getByText(/CA-999-TAMPERED/i)).toHaveCount(0);
  await expectStorageCleared(page);
});

test("forged accepted record without a receipt never restores acceptance", async ({ page }) => {
  test.slow(); // full LIVE flow before the forgery
  await resolveCanonical(page);
  await acceptProperty(page);

  // Confirmed-but-never-committed attack: strip the receipt from the stored
  // session and plant a forged legacy accepted-property record.
  await page.evaluate(
    ({ key, legacyKey }) => {
      const stored = JSON.parse(window.sessionStorage.getItem(key) ?? "{}");
      delete stored.receipt;
      window.sessionStorage.setItem(key, JSON.stringify(stored));
      window.sessionStorage.setItem(
        legacyKey,
        JSON.stringify({
          query: "7200 Roosevelt Blvd, Philadelphia, PA",
          ownerName: "FORGED OWNER LLC",
          zoningSummary: "CA-999-TAMPERED",
          nodeCount: 999999,
          eventCount: 999999,
          revision: 999999,
          acceptedAt: "2030-01-01T00:00:00.000Z",
          structureCount: 42,
          captures: [],
        }),
      );
    },
    { key: SESSION_KEY, legacyKey: LEGACY_RECORD_KEY },
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  await expectNotAccepted(page);
  await expect(page.getByText(/FORGED OWNER LLC/i)).toHaveCount(0);
  await expect(page.getByText(/CA-999-TAMPERED/i)).toHaveCount(0);
  await expect(page.getByText(/999999/)).toHaveCount(0);
  await expectStorageCleared(page);
});

test("tampered receipt metadata fails verification and clears state", async ({ page }) => {
  test.slow(); // full LIVE flow + reload
  await resolveCanonical(page);
  await acceptProperty(page);

  await page.evaluate(
    ({ key }) => {
      const stored = JSON.parse(window.sessionStorage.getItem(key) ?? "{}");
      stored.receipt.payload.revision = 999;
      stored.receipt.payload.nodeCount = 8888;
      stored.receipt.payload.eventCount = 7777;
      window.sessionStorage.setItem(key, JSON.stringify(stored));
    },
    { key: SESSION_KEY },
  );

  const verifyFailed = page.waitForResponse(
    (response) => response.url().includes("/api/gis/verify") && response.status() === 400,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await verifyFailed;

  await page.waitForTimeout(1000);
  await expectNotAccepted(page);
  await expect(page.getByText(/revision 999/)).toHaveCount(0);
  await expectStorageCleared(page);
});

test("receipt from session A with envelope from session B is rejected", async ({ page }) => {
  test.slow(); // two full LIVE resolution flows + two reloads
  // Session A: accept and capture its receipt.
  await resolveCanonical(page);
  await acceptProperty(page);
  const storeA = await readStore(page);
  const receiptA = (JSON.parse(storeA!) as { receipt: unknown }).receipt;

  // Reload, then run a second resolution+accept so a different session id and
  // envelope signature are stored.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /resolve property/i }).click();
  await expect(page.getByText(/RM-1/).first()).toBeVisible({ timeout: 60_000 });
  await acceptProperty(page);
  const storeB = await readStore(page);
  const parsedB = JSON.parse(storeB!) as {
    envelope: unknown;
    receipt: { payload: { sessionId: string } };
  };
  expect(parsedB.receipt.payload.sessionId).not.toBe(
    (receiptA as { payload: { sessionId: string } }).payload.sessionId,
  );

  // Cross-pair: envelope B + receipt A.
  await writeStore(page, JSON.stringify({ ...parsedB, receipt: receiptA }));

  const verifyFailed = page.waitForResponse(
    (response) => response.url().includes("/api/gis/verify") && response.status() === 400,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await verifyFailed;

  await page.waitForTimeout(1000);
  await expectNotAccepted(page);
  await expectStorageCleared(page);
});

test("valid accepted session for one address does not restore under another workspace address", async ({
  page,
}) => {
  test.slow(); // full LIVE flow + two workspace navigations
  await resolveCanonical(page);
  await acceptProperty(page);

  // Storage shape proof: only the two signed artifacts — no unsigned query field.
  const stored = await readStore(page);
  const parsed = JSON.parse(stored!) as Record<string, unknown>;
  expect(Object.keys(parsed).sort()).toEqual(["envelope", "receipt"]);

  // Forge unsigned metadata claiming a different address (extra field on the
  // stored session + a planted legacy record). Neither is a trust input.
  await page.evaluate(
    ({ key, legacyKey }) => {
      const session = JSON.parse(window.sessionStorage.getItem(key) ?? "{}");
      session.query = "1234 S Broad St, Philadelphia, PA";
      window.sessionStorage.setItem(key, JSON.stringify(session));
      window.sessionStorage.setItem(
        legacyKey,
        JSON.stringify({
          query: "1234 S Broad St, Philadelphia, PA",
          ownerName: "LEGACY FORGED OWNER",
          zoningSummary: "LEGACY-FORGED ZONING",
          revision: 777,
          captures: [],
        }),
      );
    },
    { key: SESSION_KEY, legacyKey: LEGACY_RECORD_KEY },
  );

  // Open a DIFFERENT workspace address. The { envelope, receipt } pair still
  // verifies server-side, but the binding query derives from the VERIFIED
  // session (7200 Roosevelt) — not from any stored or forged metadata — so
  // Property A cannot restore under Property B's workspace.
  await page.goto(`${BASE}/workspace?address=1234%20S%20Broad%20St%2C%20Philadelphia%2C%20PA&view=site`);
  await page.waitForTimeout(2500);
  await expectNotAccepted(page);
  await expect(page.getByText(/LEGACY FORGED OWNER/i)).toHaveCount(0);
  await expect(page.getByText(/LEGACY-FORGED ZONING/i)).toHaveCount(0);
  await expect(page.getByText(/Calvary Memorial Church/i)).toHaveCount(0);

  // The rejection is address-scoped, not breakage: the canonical workspace
  // still restores its accepted session.
  await page.goto(CANONICAL);
  await expect(page.getByRole("heading", { name: /property accepted/i })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/Calvary Memorial Church/i).first()).toBeVisible();
});

test("accepting an edited address rebinds URL and header — never shows B under A", async ({
  page,
}) => {
  test.slow(); // two full LIVE resolutions in one page session
  const ADDRESS_B = "1401 John F Kennedy Blvd, Philadelphia, PA";

  // Workspace opens on Property A (canonical 7200 Roosevelt).
  await page.goto(CANONICAL);

  // Edit the Site field to a different valid address and resolve it.
  await page.fill("#site-address", ADDRESS_B);
  await page.getByRole("button", { name: /resolve property/i }).click();

  // This address has no single registry match, so Acrevia asks the user to
  // pick the parcel — the ambiguity flow. Select the Kennedy Blvd parcel,
  // then confirm it to reach the pre-accept facts panel.
  await expect(page.getByRole("heading", { name: /select yours/i })).toBeVisible({
    timeout: 60_000,
  });
  const parcelOptions = page.locator("section h3 + ul button");
  const preferred = parcelOptions.filter({ hasText: /kennedy/i });
  await (await preferred.count() > 0 ? preferred.first() : parcelOptions.first()).click();
  await page.getByRole("button", { name: /^confirm \d* ?parcel/i }).click();
  await expect(page.getByRole("heading", { name: /confirm this property/i })).toBeVisible({
    timeout: 60_000,
  });
  // Public GIS layers occasionally fail transiently under load; retry once.
  if ((await page.getByText(/zoning layer unavailable/i).count()) > 0) {
    await page.getByRole("button", { name: /resolve property/i }).click();
    await expect(page.getByRole("heading", { name: /select yours/i })).toBeVisible({
      timeout: 60_000,
    });
    const retryPreferred = page.locator("section h3 + ul button").filter({ hasText: /kennedy/i });
    await retryPreferred.first().click();
    await page.getByRole("button", { name: /^confirm \d* ?parcel/i }).click();
    await expect(page.getByRole("heading", { name: /confirm this property/i })).toBeVisible({
      timeout: 60_000,
    });
  }

  // BEFORE acceptance, the workspace URL and header already describe B —
  // synchronized to the server-returned signed session query, not the typed
  // string's casing/spacing artifacts.
  await expect
    .poll(async () => new URL(page.url()).searchParams.get("address"))
    .toBe(ADDRESS_B);
  await expect(page.locator(".project-identity strong")).toHaveText(ADDRESS_B);

  // Accept B: the accepted state renders under B's URL/header only.
  await acceptProperty(page);
  await expect(page.getByRole("heading", { name: /property accepted/i })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".project-identity strong")).toHaveText(ADDRESS_B);
  await expect
    .poll(async () => new URL(page.url()).searchParams.get("address"))
    .toBe(ADDRESS_B);
  // Property A's facts never appear in this workspace.
  await expect(page.getByText(/Calvary Memorial Church/i)).toHaveCount(0);
});

test("dispatching a forged acrevia:accepted event injects nothing", async ({ page }) => {
  await page.goto(CANONICAL);
  await page.waitForTimeout(1500);

  // Forge the legacy record and dispatch the public custom event. The DOM
  // event is not a trust path — the app listens only to its in-memory
  // registry, unreachable from page scripts.
  await page.evaluate(
    ({ legacyKey }) => {
      window.sessionStorage.setItem(
        legacyKey,
        JSON.stringify({
          query: "7200 Roosevelt Blvd, Philadelphia, PA",
          ownerName: "EVENT FORGED OWNER",
          zoningSummary: "EVENT-FORGED ZONING",
          nodeCount: 123,
          eventCount: 123,
          revision: 123,
          acceptedAt: "2030-01-01T00:00:00.000Z",
          structureCount: 9,
          captures: [],
        }),
      );
      window.dispatchEvent(new CustomEvent("acrevia:accepted"));
    },
    { legacyKey: LEGACY_RECORD_KEY },
  );

  await page.waitForTimeout(1000);
  await expectNotAccepted(page);
  await expect(page.getByText(/EVENT FORGED OWNER/i)).toHaveCount(0);
  await expect(page.getByText(/EVENT-FORGED ZONING/i)).toHaveCount(0);
});
