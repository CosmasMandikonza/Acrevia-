# Acrevia Validation Field Kit

> **Status: preparation only.** This directory contains protocols and templates for
> Issue #20. No interviews have been conducted, no users have tested the product,
> no metrics have been measured, and no quotes exist. Nothing in this directory may
> be cited as evidence of validation. Evidence begins when a real session is logged
> in the evidence log.

## Why this exists

Acrevia's technical depth only becomes persuasive impact if real church and
ministry users and real development professionals pressure-test it. The goal of
this kit is to produce **evidence that Acrevia changes a real decision** — not
evidence that people think the idea is cool. Issue #20 classifies this as P0,
not post-hackathon research.

## Contents

| File | Purpose |
| --- | --- |
| `church-interview-guide.md` | Protocol for conversations with pastors, board members, trustees, property/operations leaders, denominational property leaders, and faith-based community-development leaders. |
| `professional-interview-guide.md` | Protocol for adversarial review by affordable-housing developers, architects, planners, land-use attorneys, and faith-land specialists. |
| `property-test-protocol.md` | Instrumented measurement protocol for real property runs, including the live usability script for the canonical Calvary Memorial Church journey. |
| `evidence-log-template.md` | The single source of truth for every session, observation, quote, and product change. Every pitch claim must trace to an entry here. |
| `objection-log-template.md` | Triage record for every objection raised by a participant. Every accepted objection must end in a tracked change or a written rejection rationale — never a silent drop. |
| `impact-metrics.md` | Definitions of the measurable impact claims, how each is computed, and which evidence-log fields support it. |
| `pitch-evidence-rules.md` | Strict policy governing what may be said on stage, on the landing page, or in any public material. |

### Mapping to the artifacts named in Issue #20

Issue #20 lists four artifact names; this kit implements their functions under
the file set above:

| Issue #20 artifact | Provided by |
| --- | --- |
| `interview-guide.md` | `church-interview-guide.md` + `professional-interview-guide.md` |
| `validation-log.md` | `evidence-log-template.md` (session entries `S-###` / `EV-###`) |
| `product-changes.md` | product-change entries `PC-###` inside `evidence-log-template.md`, cross-linked from `objection-log-template.md` |
| `impact-metrics.md` | `impact-metrics.md` |

## Ground rules (apply to every session)

1. **No fabrication.** No invented interviews, users, quotes, metrics, outreach,
   partnerships, or results. An empty evidence log is an acceptable state; a
   fabricated one is not.
2. **Consent before capture.** Verbal consent for the session, separate explicit
   consent for recording, separate explicit consent for quotation, separate
   written consent for being named. Record each as yes/no in the session header.
3. **Anonymized by default.** Participants are recorded as role labels
   (for example `CHURCH-BOARD-01`) unless they gave permission to be named.
4. **Sensitive information stays private.** A participant's property address,
   finances, or internal conflicts are never published. Public materials use the
   canonical fixture property or a participant property stripped of identifying
   detail, with consent.
5. **Pathways are not relationships.** Contact paths discovered in research
   (for example the access paths recorded in the Calvary benchmark README) may
   be used for outreach, but must never be presented as connections,
   endorsements, or partnerships.
6. **The participant is not steered.** Question banks in the guides are
   open-ended. Each guide lists banned leading phrasings. Facilitators do not
   demo the product before baseline questions are complete.
7. **Failure is data.** If the product errors, stalls, or confuses the
   participant, that is recorded, not hidden or excused during the session.

## The evidence ladder

From weakest to strongest. Every claim in any pitch or document must state which
rung it rests on. Move as high on the ladder as time permits.

1. **Founder hypothesis** — founder believes the problem exists.
2. **Public research** — public research confirms the problem class.
3. **Practitioner confirms problem** — a practitioner says the problem is real.
4. **Practitioner tests product** — a practitioner tests Acrevia itself.
5. **Feedback changes product** — feedback from a session causes a material
   product change (tracked as `PC-###`).
6. **Real property output judged useful** — a real property analysis is useful
   to the user (their own words plus observed behavior).
7. **User says they would bring it forward** — the user says they would take the
   output to a board or professional. (Stated intent, not action.)
8. **User actually does** — observed evidence the user brought it forward
   (meeting on a calendar, forwarded artifact, professional contacts us).
9. **Continuing pilot / design-partner relationship** — an ongoing working
   relationship that survives beyond a single session.

Rung 7 and rung 8 are different claims and must be worded differently
(see `pitch-evidence-rules.md`).

## Relationship vocabulary

Use exactly these labels. A participant holds one label until the criteria for
the next are met and logged:

| Label | Criteria |
| --- | --- |
| **Interviewed** | Answered questions in a logged session. No product exposure required. |
| **Tester** | Used or reviewed Acrevia itself (any hands-on or walkthrough exposure). |
| **Pilot** | Agreement (verbal or written, logged) to keep using Acrevia on their real property over a period of time. |
| **Design partner** | Written agreement to shape the product: recurring sessions, named contact, feedback loop. |

"Partner" alone is banned. "Customer" is banned outright until someone pays.

## Session workflow

**Before**

1. Pick the guide (church or professional); read it fully.
2. Prepare the environment per `property-test-protocol.md` (server pre-warmed,
   product commit recorded, capture mode known).
3. Have the evidence-log session header ready; consent questions on top.

**During**

4. Consent first. Then baseline questions (before any product exposure).
5. Product portion per the guide. The facilitator speaks less than the participant.
6. End with the action test, verbatim from the guide.

**After (within 24 hours)**

7. Complete the evidence-log entry: observations separated into
   OBSERVED / STATED / INTERPRETATION.
8. File every objection in the objection log; triage severity.
9. Open a GitHub issue (or extend one) for each accepted change; record `PC-###`
   when merged; update `impact-metrics.md` current values.
10. Analysis pass on the session: which evidence argues to **remove**, **redesign**,
    or **reorder** a feature? Record the answer even when it is "none".

## Analysis discipline

- **Separate three kinds of note:** OBSERVED (what the participant did),
  STATED (what they said, verbatim or marked paraphrase), INTERPRETATION
  (what we think it means). Interpretation never enters a pitch.
- **Find the strongest negative feedback first.** If nothing meaningful changed
  after a session, the test was probably too shallow — design a harder one with
  a real property and a more demanding reviewer rather than an easier participant.
- **Count the misses.** Track how many sessions produced no product change; a
  validation effort that changes nothing is a red flag about the protocol, not a
  green flag about the product.

## Current status

| Counter | Value |
| --- | --- |
| Church/ministry-side sessions | 0 (target ≥ 3) |
| Professional-side sessions | 0 (target ≥ 2) |
| Real properties analyzed end to end | 0 (target ≥ 1, preferably 2–3) |
| Documented assumptions proved wrong | 0 (target ≥ 1) |
| Material product changes from validation | 0 (target ≥ 1) |
| Objections logged | 0 |
| Continuing pilots / design partners | 0 |

Update this table only by editing it alongside the corresponding evidence-log
entries. Never edit it directly to support a narrative.
