# Evidence Log

The single source of truth for validation. **Every public claim, metric, and
quote in any pitch or document must trace to an entry in this file.** Entries
are append-only: correct an error by adding a correction entry, never by
editing history.

> Current state: **no sessions logged.** The template below defines the format.
> Do not create placeholder entries that look like data.

## Entry format

One entry per session. Copy the block; fill every field; `----` separators
between entries. IDs: sessions `S-001` upward; individual observations
`EV-<session>-<n>` when cited individually.

```markdown
## S-___ — ____-__-__ (UTC±__) — ____ (one-line description)

- Facilitator: ____
- Participant label: ____ (CHURCH-__ / PROF-__) — named? yes/no
- Role: ____   Org type: ____   Approx. size/context: ____
- Relationship level after this session: interviewed / tester / pilot / design partner
  (criteria met: ____)
- Consent: session y/n · recording y/n · quotation y/n · named y/n
- Product state: branch/SHA ____ · server dev/prod ____ · capture modes ____
- Properties tested: ____ (address or "canonical fixture" or "withheld")
- Timestamps: start ____ end ____ (M1: T0 __ T1 __ · M2: T2 __ T3 __)

### Observations

| # | OBSERVED (behavior) | STATED (verbatim or marked paraphrase) | INTERPRETATION (ours) |
| --- | --- | --- | --- |
| EV-___-1 | e.g. hovered over evidence chip without clicking | e.g. "is this from the city?" | trust boundary at source authority |
| EV-___-2 | | | |

Rules: OBSERVED = what happened on screen / in the room. STATED = participant's
words — verbatim in quotes only if quote permission is yes; otherwise marked
(paraphrase). INTERPRETATION = our inference, never citable in a pitch.

### Friction & confusion

- ____

### Distrust / objections (cross-file to objection log)

- → OBJ-____ : ____

### Requested capabilities

- ____ (in participant words where possible)

### Prior assumption challenged

- Assumption we held: ____
- What the session showed: ____
- Verdict: assumption held / incomplete / wrong — evidence: EV-___

### Next action

- Stated (verbatim): "____"
- Classification: board / professional question / feasibility study /
  compare property / invite stakeholder / pilot request / none / other
- Observed follow-through (fill in later, with date + evidence): ____

### Follow-up status

- none / scheduled ____ / completed ____ / declined (reason: ____)

### Product change resulting

- → PC-___ (issue #__ / commit ____) — material? yes/no — why: ____
- or: none. Rationale recorded (required): ____

### Analysis (facilitator, same day)

- Evidence this session argues to REMOVE a feature/claim: ____
- …to REDESIGN: ____   …to REORDER (sequence/priority): ____
- Strongest negative feedback from this session: ____
```

## Product-change entries (PC-###)

Append one block per material change caused by validation. A change is
**material** when it alters user-visible behavior, a trust claim, or a metric
definition — not typo fixes.

```markdown
## PC-___

- Caused by: S-___ (EV-___) / OBJ-___
- Change: before ____ → after ____
- Issue / PR: #__ / #__ (commit ____)
- Merged date: ____
- Verification that the change addresses the feedback: ____
```

## Verbatim quote rules

1. A quote may be recorded **only** when quote permission is yes in that
   session's header.
2. Store the exact words plus the timestamp and EV id. Trim with ellipses;
   never reorder; paraphrase-mark anything you cannot reproduce exactly.
3. A participant may withdraw a quote later — mark it withdrawn, do not delete.
4. Quotes are evidence of what one person said — never of product quality.

## Anonymization defaults

- Default label scheme: `CHURCH-<ROLE>-##` and `PROF-<ROLE>-##`.
- Org names, addresses of participant properties, and denominational
  identifiers are recorded only when the participant agreed to be named; in
  public materials they are reduced to org *type* (e.g. "single congregation,
  ~200 attendance, Northeast US city").
- Public artifacts (screenshots, recordings) require a separate review for
  identifying detail before use.

## Counters (keep in sync with README)

Sessions: church-side 0 · professional-side 0 · properties 0 · PCs 0 ·
objections 0 — update only alongside real entries above this line.
