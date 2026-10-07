/**
 * Numeric grounding guard (issue #10).
 *
 * Acrevia's rule: a number the model produces is prose until a deterministic
 * tool result contains it. This guard extracts every numeric token from the
 * Copilot's final reply and requires each consequential one to appear in this
 * turn's tool outputs. Violations trigger one corrective retry; a second
 * failure replaces the reply with the deterministic tool facts instead of
 * showing unverified numbers as project truth.
 *
 * Tool output is the SOLE numeric authority. Numbers that appear only in the
 * user's message do NOT authorize the model's claims — a user saying "make
 * 150 homes work" can never launder 150 into a verified fact. Echoing a
 * user's number is still possible exactly when it is grounded: the tools echo
 * request parameters in their results (e.g. explain_feasibility returns
 * requestedTarget), so a properly tooled reply never needs ungrounded
 * numbers.
 *
 * Small integers (0–12) are exempt: list numbering, ordinals and small counts
 * whose authoritative versions (when consequential) also appear in tool
 * output. Consequential metrics in this domain — homes, parking spaces,
 * square feet, heights, percentages — are far above that range.
 */

/** Numbers this small are treated as structural prose, not claims. */
const EXEMPT_THROUGH = 12;

const NUMBER_TOKEN = /\d+(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

function normalizeToken(token: string): string {
  return Number(token.replace(/,/g, "")).toString();
}

/** All distinct normalized numeric tokens in a text (message or JSON blob). */
export function numericTokens(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(NUMBER_TOKEN)) {
    found.add(normalizeToken(match[0]));
  }
  return found;
}

/**
 * The allow-list for one turn: numbers present in serialized tool results
 * ONLY — never user-authored text. Tool results are serialized exactly as the
 * model saw them, so any number the model could have grounded is in this set.
 */
export function allowedNumbers(toolResultJson: string[]): Set<string> {
  const allowed = new Set<string>();
  for (const blob of toolResultJson) {
    for (const token of numericTokens(blob)) allowed.add(token);
  }
  return allowed;
}

/**
 * Violating tokens in the reply, in order of appearance (deduplicated).
 * Empty array means the reply is numerically grounded.
 */
export function groundingViolations(
  reply: string,
  allowed: Set<string>,
): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const match of reply.matchAll(NUMBER_TOKEN)) {
    const token = normalizeToken(match[0]);
    if (seen.has(token)) continue;
    seen.add(token);
    if (Number(token) <= EXEMPT_THROUGH) continue;
    if (allowed.has(token)) continue;
    violations.push(match[0]);
  }
  return violations;
}
