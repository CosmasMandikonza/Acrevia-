import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * CaptureStore — raw provider responses plus metadata, in three truthful tiers
 * (issue #4 addendum). The deployed runtime NEVER depends on a writable local
 * filesystem: MemoryCaptureStore is the runtime default and FixtureCaptureStore
 * reads committed benchmark evidence. A `rawEvidenceRef` is only ever produced
 * for DURABLE bodies (committed fixtures), never for in-memory captures that
 * would vanish across requests.
 */

export interface CapturedResponse {
  body: string;
  retrievedAt: string;
}

export interface CaptureStore {
  readonly kind: "memory" | "fixture" | "durable";
  /**
   * Return a previously captured response for the key, if the store holds one.
   * Fixture stores serve committed evidence; memory stores serve this-process
   * captures. Absence returns undefined (callers degrade tiers, never guess).
   */
  get(providerId: string, key: string): CapturedResponse | undefined;
  /** Store a fresh live capture (memory stores accept; fixture stores throw). */
  put(providerId: string, key: string, response: CapturedResponse): void;
}

export class MemoryCaptureStore implements CaptureStore {
  readonly kind = "memory" as const;
  private readonly entries = new Map<string, CapturedResponse>();

  get(providerId: string, key: string): CapturedResponse | undefined {
    return this.entries.get(`${providerId}:${key}`);
  }

  put(providerId: string, key: string, response: CapturedResponse): void {
    this.entries.set(`${providerId}:${key}`, response);
  }
}

/**
 * Reads committed real provider captures from the benchmark fixture
 * directory. Keys are file basenames under raw/gis/ — the evidence is real,
 * captured live on 2026-10-04, and replayed as the FIXTURE tier.
 */
export class FixtureCaptureStore implements CaptureStore {
  readonly kind = "fixture" as const;
  constructor(private readonly fixtureDir: string) {}

  get(providerId: string, key: string): CapturedResponse | undefined {
    const path = join(this.fixtureDir, `${key}.json`);
    if (!existsSync(path)) return undefined;
    return {
      body: readFileSync(path, "utf-8"),
      retrievedAt: FIXTURE_CAPTURED_AT,
    };
  }

  put(): never {
    throw new Error("FixtureCaptureStore is read-only (committed evidence)");
  }
}

/** Capture date of the committed GIS fixture evidence. */
export const FIXTURE_CAPTURED_AT = "2026-10-04T17:41:00Z";

export function sha256Of(body: string): string {
  return createHash("sha256").update(body, "utf-8").digest("hex");
}
