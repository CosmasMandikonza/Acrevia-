import { createHash } from "node:crypto";

/**
 * Hashing port. The domain depends on this one function only, so a Web-Crypto
 * implementation can replace it without touching domain logic.
 */
export function createSha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
