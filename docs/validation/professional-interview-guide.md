# Professional Interview Guide

Audience: affordable-housing developers, architects, planners, land-use
attorneys, faith-land / church-property specialists, predevelopment and
community-development professionals. Target: **at least 2 sessions** (Issue #20).

The posture is **adversarial collaboration**. These participants are proxies for
the exact judges, clients, and gatekeepers Acrevia must survive. We are not
asking them to like the product; we are asking them to attack its trust claims
and tell us what would have to be true for it to be useful to them before a
client pays for an expensive feasibility study.

Open the session by saying exactly that:

> "Our goal today is for you to break this. If Acrevia would mislead a church
> client, or waste your time, or create liability, we want to hear it in the
> strongest terms you can put it. We record every objection and we either fix
> it or write down why we didn't."

## Facilitator rules

- Same consent script and note discipline as the church guide
  (see `church-interview-guide.md`; use `PROF-*` participant labels).
- Part A (their world) before any product exposure.
- Never argue with an objection during the session. Ask for the underlying
  standard: "What would you need to see to change your mind?"
- If a professional validates something, record the exact scope of what was
  validated. "The evidence structure is reasonable" is not "the analysis is
  correct."
- Do not overstate product maturity: the implemented surface today is
  address → verified property resolution with evidence states and capture
  provenance → mission constraints as confirmed Development Graph rules,
  plus the hand-built canonical benchmark pack. Scenario computation, 3D,
  and capital modeling are roadmap.

## Part A — their world (before seeing Acrevia)

1. "When a church or faith organization calls you and asks
   *'could we build housing on our property'* — walk me through what happens
   in the first month. Who pays for what, and when?"
2. "What do you need from the client before you can say anything useful?"
3. "Where do church clients typically stall or give up?"
4. "What does the first round of feasibility answers cost them — in money and
   in time — before anyone can make a decision?"
5. "What has gone wrong for faith clients you've worked with — the horror
   stories?"
6. "Have you seen churches burned by bad information about their own land?
   What did that look like?"

## Part B — attack surfaces

Show the canonical Calvary Memorial Church run (live or via
`property-test-protocol.md` walkthrough) **and** the benchmark pack:
`docs/benchmarks/calvary-memorial-philadelphia/` — `sources.manifest.json`
(13 sources, authority levels, retrieval timestamps), `rules.expected.json`
(27 rules with quotes and evidence states), `open-questions.json` (14
unknowns / expert-required items), and `README.md` (the evidence chain, the
deliberate non-claims, currentness limits).

Present each surface with a neutral prompt, then let them lead. Suggested
prompts by attack surface:

### 1. Regulatory interpretation

- "The RM-1 dimensionals come from the PCPC Quick Guide (a city-published
  guide, not the adopted code). The FAR is recorded as UNKNOWN rather than
  estimated. Attack that choice."
- "Parking and the /SIX overlay quote come from the adopted code captured live.
  The guide table cites a Feb 2026 publication that self-describes as
  non-authoritative. How would you treat this mix?"
- "Which of these 27 rules would you refuse to rely on, and why?"

### 2. Evidence / provenance

- "Every fact carries a source, an authority level, and a retrieval timestamp.
  Re-verification is currently manual. What's missing before you'd trust this
  chain?"
- "Does the authority hierarchy (adopted code > official GIS > city reference
  > self-reported) match how you would weight sources? Where is it wrong?"

### 3. False confidence

- "Where could this product make a weak conclusion look strong?"
- "What would a church misunderstand here even if everything shown is
  accurate?"

### 4. Parcel ambiguity

- "The resolver shows multiple candidate parcels when an address is ambiguous.
  What church-property situations break parcel resolution — multiple parcels
  under one name, leased land, shared driveways, split zoning?"

### 5. Existing-building preservation

- "The sanctuary is a real resolved structure that mission rules can protect.
  Historic-register status for this parcel is an open question, not a fact.
  What preservation issues does that miss?"

### 6. Scenario feasibility (approach review — scenarios are roadmap)

- "Scenario generation, massing, and the solver are designed but not yet
  implemented. Judging the approach only: what would the scenarios have to
  prove before they're worth a church's attention?"

### 7. Handoff to professionals

- "Imagine a church arrives at your office with this output. What would make
  it a useful starting point? What would make you discount it?"
- "What is missing from the packet you'd want in the first email?"

### 8. Unsafe / untrustworthy triggers

- "Describe a concrete situation where using this tool would make things
  *worse* for a congregation than not using it."

### 9. Useful-before-expensive-study

- "What would this have to show — concretely — before you'd tell a church
  client it was worth their time, or before it changed what you'd bill for
  early feasibility?"

## Capture requirements

- Every objection goes in the objection log with severity, same day.
- For each surface, record the professional's verdict in their own words:
  - what they accepted,
  - what they rejected,
  - what they conditioned ("acceptable if X").
- Their stated next-step interest ("I'd review an output like this if a client
  brought it") is STATED INTENT — rung 7 at best — unless they act.

## Closing

> "If we fixed the things you flagged, would this be worth another
> conversation? What would you want to see next time?"

Record the answer verbatim; do not press for commitment. Follow-up permission:
[ ] yes [ ] no.
