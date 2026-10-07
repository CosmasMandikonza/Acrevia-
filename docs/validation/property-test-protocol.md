# Property Test Protocol

Purpose: measure what actually happens when a real person runs a real property
through Acrevia — with a stopwatch, not an opinion. This protocol is the
measurement instrument behind `impact-metrics.md`.

**Nothing below has been run with a participant yet.** All target values are
blank until a logged session produces them.

## 1. Environment preparation (before the participant arrives)

| Item | Requirement | Recorded as |
| --- | --- | --- |
| Code state | `main` branch (or a named branch), clean tree | git SHA `____` |
| Server | local dev or production server, already started | mode `dev` / `prod`, port `____` (e.g. 3121) |
| Internet | LIVE public endpoints (Census, Philadelphia CARTO/ArcGIS, L&I) reachable | connectivity ok? yes/no |
| Pre-warm | Run the canonical address once, end to end, before the participant session | pre-warmed? yes/no, duration `____` |
| Capture mode | Note whether the run will hit LIVE, CACHED, or FIXTURE data per layer | mode per layer |

Why pre-warm: first-ever resolution on a cold server includes toolchain
warm-up and can take a minute or more. That latency is real and worth knowing,
but it is **environment**, not product. Timing metrics (M1/M2) are measured on
a pre-warmed server; cold-start time is recorded separately and disclosed
alongside, never hidden.

Honesty rule for live data: if a layer failed and the run used cached or
fixture fallback, the session's timing and counts must say so. A FIXTURE-mode
number may never be presented next to a LIVE-mode number without labeling.

## 2. Property selection

1. **Canonical first:** Calvary Memorial Church, 7200 Roosevelt Blvd,
   Philadelphia, PA — the benchmarked fixture property. Participant-naive
   property (not their church), so friction reflects the product, not their
   attachment.
2. **Then 1–2 unfamiliar real properties** (target 2–3 properties total,
   Issue #20) to show the product is not a single-fixture trick. Prefer:
   - a participant's own congregation property (with consent; treat address as
     sensitive), and/or
   - another city church found in public research.
3. For every run, record the property the same way as the canonical benchmark
   does: jurisdiction, source layers hit, capture modes, failures.

## 3. Measured variables

| ID | Measure | Definition | Instrument |
| --- | --- | --- | --- |
| M1 | Address → credible property snapshot | T0 = participant clicks **Resolve property** with the address entered; T1 = **"Property accepted"** state visible. | stopwatch / screen recording |
| M2 | Mission constraints → confirmed model | T2 = participant submits the mission sentence (**Interpret**); T3 = all intended rules show as confirmed `MUST KEEP` chips with the revision advanced. | stopwatch / screen recording |
| M3 | Authoritative sources surfaced | Count of distinct sources/evidence records shown for the accepted property (evidence rail / manifest). Note authority tier per source where shown. | facilitator tally |
| M4 | Unresolved / expert-review items surfaced | Count of UNKNOWN / EXPERT REQUIRED / open-question items visible at snapshot time (e.g. FAR UNKNOWN, historic-register status). | facilitator tally |
| M5 | Comprehension | Facilitator rubric per probe, 0–2: 2 = participant restates the claim accurately in own words unprompted; 1 = partial or prompted; 0 = cannot. Recorded per stop, never averaged away — report the distribution. | comprehension probes (§5 B1) |
| M6 | Trust | (a) Which evidence states did the participant notice **unprompted**; (b) what they said they would verify independently and how; (c) their stated trust rating 0–5 with reason. | observation + question |
| M7 | Usefulness | Participant's own 0–5 rating **with the reason in their words**; facilitator records what they said it would be useful *for*. | question |
| M8 | Next action | Verbatim answer to the action test; classified afterward (board / professional / study / compare / invite / pilot request / nothing / other). | verbatim capture |
| M9 | Material product changes caused | Count of `PC-###` entries citing this session. This is the only measure that counts as rung 5 evidence. | evidence log |

Timing honesty: record T-values as observed (mm:ss), with capture mode. If the
facilitator intervened, timing is annotated "assisted" and not used for the
headline number — but it is still logged.

## 4. Live usability script — canonical Calvary journey

Scope note: this script covers the **implemented** journey — resolve → confirm
→ accept → mission sentence → interpretation review → confirmed mission rules.
Scenario/3D/capital surfaces are roadmap; if asked, say so plainly.

**Setup.** Participant at the keyboard. Screen recording if consented.
Timestamps at: session start, each task start/end, session end.

**Think-aloud instruction (verbatim):**

> "As you go, say whatever you're thinking — what you're looking for, what
  confuses you, what you like or don't. There are no wrong moves, and nothing
  you do can break anything."

**Task 1 — arrive at a property you'd trust (M1 starts).**

Say only:

> "Start on this screen. Type this address: 7200 Roosevelt Blvd,
>  Philadelphia. Get to a property you'd trust enough to keep working with."

Participant drives through resolution and parcel confirmation themselves
(ambiguous-address handling is part of the test). Facilitator help protocol:
note the struggle timestamp; help only after 60 full seconds of being stuck;
log every assist. Record every observed confusion point.

**Task 2 — accept.**

> "When you're satisfied it's the right property, accept it."

**Task 3 — mission sentence (M2 starts).**

> "The screen now asks what the property must protect. Type this, in your own
>  words exactly as you'd say it to your board:
>  'Keep the sanctuary. Keep at least 110 Sunday parking spaces. We are not
>  selling the land.'"

(If the participant prefers their own sentence, allow it and record it
verbatim — comparability note in the log.)

**Task 4 — review the interpretation. Non-leading probes, in order:**

- "Before you confirm anything — what do you understand Acrevia is proposing?"
- "Is anything here you would **not** confirm? Why?"
- "Did it understand your sentence the way you meant it?"
- "What do you think happens when you confirm?"

**Task 5 — confirm the mission rules.**

> "Confirm the rules you're comfortable confirming."

Observe: does the participant confirm selectively? Do they look for an
explanation of consequences (binding constraints, revision number)? Record
what they inspect unprompted.

**Task 6 — wrap (M6/M7/M8).**

- "How much do you trust what you just got, 0 to 5 — and what makes it that
  number rather than higher or lower?"
- "Is there anything here you'd want to check yourself before showing anyone?
  How would you check it?"
- "How useful is this to you, 0 to 5 — useful for what, exactly?"
- Action test, verbatim, last: **"What would you do next after seeing this?"**
- Then stop. Options may not be listed.

## 5. Session record (one per run — copy into the evidence log)

```
Session ID:            S-___  (EV-___)
Date / timezone:       ____-__-__  (UTC±__)
Timestamps:            started ____  T0 ____  T1 ____
                       T2 ____  T3 ____  ended ____
Assists by facilitator (count + at what): ____
Participant role:      ____ (e.g. pastor / board member / trustee /
                       property-ops leader / denominational leader /
                       developer / architect / planner / attorney /
                       faith-land specialist / other: ____)
Participant label:     CHURCH-____ / PROF-____   named with permission? y/n
Organization type:     ____ (e.g. single congregation / denomination /
                       nonprofit developer / for-profit developer / firm / agency)
Permission to quote:   yes / no      recording consent: yes / no
Follow-up allowed:     yes / no
Property tested:       ____ (address OR "canonical Calvary fixture" OR
                       "participant property, address withheld")
Server/capture mode:   SHA ____  dev/prod ____  LIVE/CACHED/FIXTURE per layer: ____
Task completion:       resolve [ ] unaided [ ] assisted [ ] failed
                       accept  [ ] unaided [ ] assisted [ ] failed
                       mission [ ] unaided [ ] assisted [ ] failed
                       confirm [ ] selective? ____  [ ] failed
Measured:              M1 ____ (mm:ss)   M2 ____ (mm:ss)
                       M3 ____ sources   M4 ____ open items
                       M5 scores per probe: ____
                       M6 noticed unprompted: ____ rating ____ reason: ____
                       M7 rating ____ useful-for: ____
                       M8 verbatim: "____"  classification: ____
Confusion points:      ____
Objections:            → OBJ-____
Requested capabilities: ____
Next action (stated):  "____"
Follow-up status:      none / scheduled ____ / completed ____ / declined
Product change:        → PC-____ / issue #__ (or "none — recorded rationale: ____")
Prior assumption this session challenged: ____
```

## 6. Failure handling

Product failures during a session (errors, stalled resolution, wrong parcel)
are recorded verbatim with timestamps and become objections or issues. Do not
restart silently; if a restart is needed, the failed attempt stays in the log
and the timing annotation says "post-restart".

## 7. After the run

Within 24 hours: evidence-log entry complete, objections filed, issues opened
for accepted changes, `impact-metrics.md` values updated with the new
evidence-log IDs, README counters updated.
