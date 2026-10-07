# Church Interview Guide

Audience: pastors, church board members / trustees, property or operations
leaders, denominational / diocesan property leaders, faith-based
community-development leaders. Target: **at least 3 sessions** (Issue #20).

Two goals, in strict order:

1. Understand the **current burden** — what really happens today when a
   congregation asks "Could we build housing here?" (evidence ladder rung 3).
2. Test the **Acrevia experience** on a real property and observe whether the
   address → property → mission workflow is understandable, credible, and
   consequential to them (rungs 4–7).

## Facilitator rules

- **Part A before any product exposure.** Do not show, describe, or hint at
  Acrevia until Part A is complete. Recall of the current process is contaminated
  once the participant has seen an alternative.
- **Open questions only.** Ask "how / what / walk me through / tell me about."
  Never "do you agree", "wouldn't it be useful if", "how much do you like".
  Full banned list:

  - "Do you think this is a good idea?"
  - "Wouldn't it be great if you could just type your address and…"
  - "So this solves your problem, right?"
  - "How impressed are you with…?"
  - Any question that contains the answer you want.

- **Silence is the instrument.** After asking, wait. Do not rescue the
  participant from thinking.
- **Probe for specifics.** "When was the last time that actually happened?"
  beats "Does that happen?"
- **Do not defend the product** in Part B. When criticized, ask "Say more about
  that" and write it down. Objections are deliverables, not attacks.
- **Honesty about what Acrevia is.** If asked: Acrevia is a preliminary
  development-intelligence tool. It does not replace architects, planners,
  attorneys, developers, lenders, or formal feasibility studies, and it does not
  make legal conclusions.

## Opening and consent (record verbatim yes/no in the session header)

> "Thanks for meeting. I'd like to understand how your congregation thinks
> about its property — first just how things work today, and then I'll show you
> a tool we're building and I mostly want your honest reaction, especially the
> critical parts. Nothing you say will be quoted or attributed without your
> permission. Is it okay if I take notes? [ ] yes [ ] no
> May I record audio so my notes are accurate? [ ] yes [ ] no
> If you say something worth quoting later, I'll ask you then — okay? [ ] yes [ ] no"

Timestamp at start: `____` (ISO-8601, with timezone).

## Part A — current burden (before seeing Acrevia)

Ask in roughly this order; follow energy, not the script.

1. "Tell me about your congregation's property. What do you have?"
2. "Has your congregation ever asked — out loud, in a meeting —
   *'Could we build housing here?'*"
   - If yes: "Walk me through what happened next, step by step. Who spoke up?
     What did you do first? Then what?"
   - If no: "Imagine the board asked that question tomorrow. What would happen
     first? Who would you call? What would you need to know before anything
     else?"
3. "Where does that process stall? What's the point at which it usually dies?"
4. "What information was hardest to get or hardest to understand?"
5. "When you've talked to professionals — architects, planners, developers,
   consultants — what did they need from you before they could help?"
6. "What makes your board or congregation nervous about property ideas?"
7. "Some churches are shown tools that use AI to answer feasibility questions.
   What would make **you** distrust a result like that — no matter who showed it
   to you?"
8. "Who would have to be at the table before your congregation could say yes to
   even a next step?"

Capture for each answer: OBSERVED / STATED / INTERPRETATION (see evidence-log
template). Timestamp when Part A ends: `____`.

## Part B — the Acrevia experience

Run the **live usability script** in `property-test-protocol.md` (participant
hands-on, canonical or participant property). If hands-on is impossible
(remote, low time), present the facilitator-operated walkthrough at the same
stops and keep the same probes. Do not narrate features the product does not
have; the current implemented surface is address → resolved property with
evidence states → mission constraints as confirmed project rules. Scenario
computation, 3D, and capital modeling are roadmap, not present, and must be
described as such if asked.

### B1. Comprehension probes (neutral, at each stop)

- "In your own words, what is this screen telling you?"
- "What do you make of these labels?" (SOURCE_CONFIRMED / ASSUMPTION /
  EXPERT REQUIRED / LIVE / CACHED — whichever are visible)
- "Is there anything here you would want to check yourself before believing it?
  How would you check it?"
- "What's missing from this picture, if anything?"

### B2. Mission-constraint realism probes

After the participant has entered (or read) their mission sentence and seen
Acrevia's interpretation:

- "Are these the kinds of things your board would refuse to compromise on —
  sanctuary, Sunday parking, keeping the land? What's on your list that isn't
  on this one?"
- "Did Acrevia understand your sentence the way you meant it? Where did it get
  it wrong or miss something?"
- "Is anything here that your board would consider *not* negotiable that this
  tool treated as optional — or the reverse?"

### B3. Sharing and consequence probes

- "Who, if anyone, would you show this to? What would they ask you about it?"
  (board / architect / planner / developer / denomination — note which)
- "What would need to be true for you to put this in front of your board?"
- "What would this have changed the last time your congregation discussed the
  property — if anything?"

### B4. Action test (verbatim, last)

> "What would you do next after seeing this?"

Then stop. Do not offer options, do not read the strong-signal list aloud.
Record the answer verbatim. Strong signals per Issue #20 include: take it to
the board, ask a planner/architect a specific question, explore a professional
feasibility study, compare another property, invite another stakeholder,
request continued pilot access — but the participant must produce it.

### B5. Close (optional, clearly marked as intent — not action)

- "Would you want to try this on your own congregation's property?"
- "Would it be okay if I followed up in a few weeks? How?"

Record both as STATED INTENT in the evidence log. Intent is rung 7 evidence at
best; it is never evidence of use.

## Red flags to record immediately

- Participant defers to the facilitator ("well if you built it, it must be
  right") — note it; deference is not validation.
- Participant asks "is this legal advice?" — record the question; it is a
  trust-boundary signal.
- Participant cannot restate what the screen claimed — comprehension failure,
  log as OBSERVED.
- Facilitator explained something twice — log as confusion point even if the
  participant then succeeds.

## After the session

Complete the evidence-log entry within 24 hours; file objections; open or
update issues for accepted changes; update the README counters and
`impact-metrics.md`.
