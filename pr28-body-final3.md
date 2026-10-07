## What

Closes #5. Acrevia now **compiles law instead of retrieving it**, and the final closeout makes the central invariant mechanically true end to end: **the model can propose meaning, but only evidence-derived semantics can execute.**

## VerifiedRule — verifier-owned semantics (final closeout)

`verifyCandidates` now returns a `VerifiedRule` carrying `verifiedExcerpt` (the capture-backed anchor), `verifiedLocator`, and `verifiedValue` — a `CanonicalVerifiedValue` **derived from the captured evidence**, never from `candidate.proposedValue` or `verbatimSupportingText`. Everything downstream — conflict comparison, canonical Claim values, Regulation construction, and the executable constraint payload — consumes ONLY the VerifiedRule.

Every executable predicate and how its semantics are independently derived:
- **max-height / lot-width / setback-rear**: `normalizeFeet` on the anchor span.
- **setback-side (5–12 ft)**: range parsed from the anchor/capture row.
- **setback-front (contextual)**: verifier-owned rule id naming the blockface mechanism — no number derives from prose; #7 evaluates it against geometry.
- **occupied-area**: `Intermediate N%; Corner M%` parsed from the anchor/capture (75/80, never a proposed 90).
- **density-formula**: all three tier numbers (360/1,440/480) parsed from the captured note.
- **parking-requirement (fixed)**: the RM-1 value read from **column group 2 of the pipe-delimited adopted-code row** ("Multi-Family — 1 | 0 | 3/10 units"), not the extractor's number; **(formula)**: formula text taken from the capture span.
- **use-permission**: permission letter re-read from the anchor's last table cell (N vs Y vs S).
- **overlay-prohibition**: prohibition subject re-read from the anchor span.
- **density-bonus**: both tiers (Moderate 25 / Low 50) parsed from the capture.

Cross-checks reject drift (anchor says 38, proposal says 55 → REJECT; anchor N, proposal Y → REJECT). Rules whose semantics cannot be fully derived **abstain**: FAR, GIS site facts, overlay listings, lot width/area → sourced Claim only (or Claim + non-executable note), never a Regulation, never a Constraint, never a conflict vote.

**Adversarial meta-regression (the trust boundary):** mutating EVERY extractor-owned field (`proposedValue` + `verbatimSupportingText` + qualitative text) across the whole benchmark corpus while leaving captures unchanged changes **nothing executable** — each mutated rule is either rejected or compiles to semantics identical to baseline; fabricated renderings never reach canonical quotes. Per-predicate regressions cover: use N/Y and S/Y; occupied-area 75/80 vs 90; side-yard 5–12 vs 5–30; density 480 vs 900; bonus Low 50 vs 80; ADU non-prohibition vs fabricated prohibition; parking formula substitution.

## FAR stays Claim-only

FAR UNKNOWN → UNKNOWN Claim → **no Regulation → no Constraint → no solver decision** — exact regression.

## LAW vs APPLIES HERE (two-strand provenance)

Compiled-law responses and the Evidence UI report, per rule: **LAW** (legal claim/source/locator/verified excerpt) separately from **APPLIES HERE** (the site's own zoning-base or overlay claim + official-GIS source). Classification is by claim namespace (`phl:claim:` vs `gis:claim:`), never "first claim found." Browser-proven: the height row's LAW source is the Quick Guide/adopted code, never the zoning GIS layer; APPLIES HERE carries RM-1 + the L&I zoning GIS source. Screenshot: `docs/reviews/issue-5/compiled-law-4-law-vs-applies.png`.

## Applicability-source resolution

Compiler-boundary validation now requires EVERY cited applicability source to resolve to a live `source-artifact` (already-superseded sources fail closed) — regressions for nonexistent and already-superseded sources. `rawEvidenceRef` is persisted for single-file captures (multi-file details stay in `versionNote`).

## Everything else from prior rounds (still proven)

Property binding fail-closed (A→B, needs-evidence, unsupported-district, multi-parcel); captured-version observation identity (S5@v1/S5@v2); semantic rule identity; resolved-law updates via the audited `replaceExecutableConstraint` (55→45, BY_RIGHT→SPECIAL_EXCEPTION, old cert STALE, new cert CURRENT); canonical quotes from verified anchors; qualitative conflicts in normalized verified semantics; order invariance; true idempotency; source-supersession certificate staleness; executable gate with reasons.

## Tests

- **Vitest 282/282** (27 files; 58 regulatory tests incl. 9 verifier-ownership + FAR claim-only + applicability-source regressions).
- **Playwright: 9/9 regulatory journeys on dev** (compiled-law 3, property A→B 3, LAW vs APPLIES HERE 3) and **9/9 on a production build** with the signing secret set.
- `tsc --noEmit` strict, `eslint`, `next build` clean.

## Intentionally downgraded to non-executable (documented abstention)

Overlay *applicability listings* (GIS facts: /SIX-applicability, sign controls, NIS, childcare standards) and jurisdiction-frame/governance/site facts are Claim-only by design — they carry no executable law semantics. FAR remains UNKNOWN. Lot width/area stay sourced Claim+Regulation facts without constraints until #7 defines their participation.

## Deferred

#7 solver (consumes the gate only); #10 model extraction behind the anchored adapter; districts beyond RM-1 (fail-closed); retiring the legacy benchmark mapper (kept as seed; parity proven).
