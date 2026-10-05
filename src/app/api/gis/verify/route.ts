import { NextResponse } from "next/server";
import {
  verifyEnvelope,
  type ResolutionEnvelope,
} from "../../../../adapters/gis/resolution-envelope";
import {
  assertReceiptMatchesEnvelope,
  verifyCommitReceipt,
  type CommitReceipt,
} from "../../../../adapters/gis/commit-receipt";

/**
 * Server verification boundary for client-stored accepted sessions (PR #25).
 *
 * sessionStorage is NEVER a source of verified truth, and a signed
 * ResolutionEnvelope alone only proves the provider-derived facts are
 * authentic — it does not prove a commit happened. Restoring an accepted
 * state therefore requires BOTH server attestations:
 *
 *   1. the ResolutionEnvelope's full-session HMAC signature;
 *   2. the CommitReceipt's HMAC signature (issued only after an atomic
 *      commit + integrity encode succeeded);
 *   3. the receipt was issued for THIS envelope (signature binding);
 *   4. the receipt session id matches the envelope session;
 *   5. the receipt's project/property ids match the accepted-parcel
 *      convention derived from the envelope.
 *
 * Only then does the response return the verified session AND the verified
 * receipt metadata (revision, node/event counts, committed time), from which
 * every displayed commit fact must be derived. Any failure returns only
 * { valid: false } — never unverified content. Stateless: nothing is
 * persisted server-side.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { envelope?: ResolutionEnvelope; receipt?: CommitReceipt };
  try {
    body = (await request.json()) as { envelope?: ResolutionEnvelope; receipt?: CommitReceipt };
  } catch {
    return NextResponse.json({ valid: false, reason: "invalid JSON body" }, { status: 400 });
  }
  if (
    !body.envelope ||
    typeof body.envelope !== "object" ||
    !body.envelope.session ||
    typeof body.envelope.signature !== "string"
  ) {
    return NextResponse.json(
      { valid: false, reason: "verify requires a signed envelope" },
      { status: 400 },
    );
  }
  // An envelope without a receipt is a confirmed-but-never-committed (or
  // forged) session: acceptance requires server attestation of the commit.
  if (
    !body.receipt ||
    typeof body.receipt !== "object" ||
    !body.receipt.payload ||
    typeof body.receipt.signature !== "string"
  ) {
    return NextResponse.json(
      { valid: false, reason: "verify requires a signed commit receipt" },
      { status: 400 },
    );
  }

  try {
    const session = verifyEnvelope(body.envelope);
    const receiptPayload = verifyCommitReceipt(body.receipt);
    assertReceiptMatchesEnvelope(receiptPayload, body.envelope);
    return NextResponse.json({ valid: true, session, receipt: receiptPayload });
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    if (name === "MissingSecretError") {
      // Fail closed: without the production secret nothing can be verified.
      return NextResponse.json(
        { valid: false, reason: "verification secret unavailable" },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { valid: false, reason: "verification failed", name },
      { status: 400 },
    );
  }
}
