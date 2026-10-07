# Objection Log

Every objection, doubt, and distrust signal raised by a participant gets an
entry here — the same day it was raised. **No objection is ever dropped
silently:** each one ends either in a tracked product change or in a written
rejection rationale. This log is the input to the "did feedback actually change
the product" acceptance criterion (Issue #20) and the strongest-negative-
feedback audit.

> Current state: **no objections logged.** The template below defines the format.

## Entry format

```markdown
## OBJ-___ — ____-__-__ — ____ (one-line summary)

- Raised in: S-___ by ____ (label, not name unless named-permission)
- Verbatim / paraphrase: "____"
- Attack surface (pick primary): regulatory-interpretation / evidence-provenance /
  false-confidence / parcel-ambiguity / existing-building-preservation /
  scenario-feasibility / handoff-to-professionals / safety-trust /
  comprehension / other: ____
- Severity (triage):
  - [ ] blocker — would mislead a user or make the product unsafe to rely on
  - [ ] major — would stop a real user/professional from continuing
  - [ ] minor — friction, polish, wording
- Underlying standard (what would make it acceptable, in the objector's words): "____"
- Status: open / accepted-fixed / accepted-deferred / rejected
- If accepted-fixed:  → PC-___ · issue #__ · verified how: ____
- If accepted-deferred: issue #__ · reason and revisit condition: ____
- If rejected: rationale (must be written, must be strong enough to say to the
  objector's face): ____
```

## Triage rules

1. **Blockers jump the queue.** A blocker means the current output could
   mislead someone about their own property; it is escalated to an issue the
   same day.
2. **Defer with a condition, not a shrug.** "Accepted-deferred" requires the
   condition under which it will be addressed.
3. **Rejections are auditable.** The rationale field exists so that a skeptical
   judge (or future us) can distinguish "we considered and declined for cause"
   from "we ignored it."
4. **Same objection raised twice by different participants** gets a new entry
   cross-referencing the first — repetition is severity evidence, not duplicate
   noise.

## Standing audit questions (run before any pitch)

- What is the strongest unresolved objection in this log? Can we say it out
  loud on stage before a judge finds it?
- What changed because of our strongest objections? If the answer is
  "nothing", the validation was too shallow — design a harder test
  (real property, more demanding reviewer), per Issue #20's recovery prompt.
- Which objections did we reject, and would the objector accept our rationale?

## Counters

Objections: 0 (blockers 0 / major 0 / minor 0) · resolved 0 · open 0 — update
only alongside real entries.
