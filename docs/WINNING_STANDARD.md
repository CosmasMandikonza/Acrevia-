# Acrevia Winning Standard

This document defines the bar for every product, engineering, validation, and presentation decision in Acrevia.

Acrevia is not being built to be merely eligible, complete, or visually impressive. It is being built to compete across:

- Grand Prize
- Best in Ministry Track
- Best Technology
- Best Design
- Best Storytelling

The project should therefore be evaluated on five simultaneous dimensions:

1. **Human outcome** — does this meaningfully help a real church move a real property decision forward?
2. **Technical depth** — is there difficult, defensible engineering beneath the experience?
3. **Product quality** — can the intended user actually use it without a developer operating the system?
4. **Trust** — can consequential outputs be traced, tested, challenged, and safely escalated?
5. **Story** — can a judge understand the person, pain, transformation, and proof in seconds?

## Core strategy

> **Startup-sized product. Judge-sized story.**

Acrevia can be technically broad and deep. The pitch must not try to narrate all of that breadth.

Technical depth is infrastructure for the outcome, not the opening line of the pitch.

The audience should first understand:

- who is stuck,
- why the current process fails them,
- what Acrevia changes,
- and what they can now do that they could not do before.

Then the product demonstration reveals why the result is credible.

## Primary user

Do not pitch to "churches" as an abstract market.

The canonical user should be a specific, believable person such as:

> A pastor or church board member who believes underused church property could serve the community but cannot confidently answer the first development question: **what can actually happen here?**

Our design-partner work should refine this into a real named role and real observed burden.

## Primary transformation

Before Acrevia:

- church owns underused property
- board has mission intent
- zoning / parcel / feasibility / parking / financing information is fragmented
- leaders do not know what is realistic
- the project stalls before professional predevelopment begins

After Acrevia:

- address resolves into a real Development Twin
- relevant public rules are sourced and compiled
- church mission requirements become constraints
- multiple scenarios are computed
- impossible requests are refused with reasons
- the site becomes visible in 3D
- assumptions / conflicts / expert-required items are explicit
- the church leaves with a credible next-step package for its board and professionals

## Impact model

Do not overclaim downstream outcomes that Acrevia cannot prove during the hackathon.

### Direct measurable impact

Measure:

- time from address to preliminary feasibility snapshot
- number / percentage of consequential rules with authoritative provenance
- number of unresolved expert-review items surfaced rather than guessed
- time to produce board/council-ready material
- whether a real church leader says they would use/show the output
- whether a planner/developer/architect finds the handoff useful
- whether feedback materially changes the product

### Credible downstream impact

We may discuss:

- more faith-owned parcels reaching professional feasibility
- faster prioritization of promising sites
- fewer projects abandoned at the intimidating first step
- potential affordable-housing capacity identified on real properties

Only present housing-unit or portfolio-impact numbers when they were actually computed from defined properties and assumptions.

### Do not claim

Do not say Acrevia "ends homelessness", "saves lives", or directly creates housing unless the evidence supports that claim.

A stronger statement is:

> Acrevia helps churches move viable housing ideas from conviction to a credible first development decision.

If a real partner moves a project to a board, planner, architect, or developer because of Acrevia, document that. That is powerful evidence.

## Technical-depth standard

The engineering must remain deeper than the pitch.

A strong implementation should include as many of these as can be made real and coherent:

- canonical Development Graph
- authoritative parcel / jurisdiction resolution
- typed regulatory compiler
- provenance ledger
- conflict / stale-source detection
- Mission Compiler
- deterministic geometry + scenario solver
- binding-constraint analysis
- no-solution proofs / nearest valid alternatives
- scenario certificates
- evidence-linked 3D Forge
- tool-using Copilot over typed project actions
- preliminary deterministic capital model
- stakeholder / Council views derived from the same project state
- portfolio layer that reuses the same substrate
- adversarial eval harness
- dependency invalidation / project re-evaluation

Do not add a feature merely because it sounds impressive. Every module must share the Development Graph or derive from it.

## The no-slop rule

A feature is not complete because:

- the UI renders
- an LLM returns plausible prose
- the screenshot looks polished
- a single demo fixture passes

A feature is complete only when:

1. the user-facing behavior is clear
2. the underlying state is real
3. edge/failure cases are handled
4. important numbers are derived rather than invented
5. the feature integrates with the shared model
6. the result is testable
7. the screen meets the Design Constitution
8. the behavior advances either challenge fit, impact, innovation, AI depth, trust, or presentation

## Real-user validation standard

Validation is P0.

Before final submission, target:

- at least 3 conversations with church / ministry property decision-makers or credible representatives
- at least 2 conversations with practitioners such as affordable-housing developers, planners, architects, land-use professionals, or faith-land specialists
- at least 1 real property run through Acrevia end to end
- preferably 2–3 real properties for robustness
- at least 1 documented instance where feedback changed the product
- ideally one design partner willing to continue after the hackathon

For each conversation record:

- role / context
- current workflow
- painful step
- what they did not understand before Acrevia
- reaction to the output
- what they distrusted
- what they would need before taking a next step
- exact product change triggered by the interview

Do not manufacture quotes, logos, customer status, or implied partnerships.

## Evidence ladder

From weakest to strongest:

1. founder believes problem exists
2. public research confirms problem class
3. practitioner says problem is real
4. practitioner tests Acrevia
5. feedback changes Acrevia
6. real property analysis is useful to user
7. user says they would take output to board/professional
8. user actually does so
9. continuing pilot/design-partner commitment

Move as high on this ladder as time permits.

## Presentation strategy

Acrevia needs two cuts.

### Preliminary — 3 minutes

Goal: advance.

Suggested structure:

**0:00–0:25 — Human hook**
One real church / board / property situation. No architecture jargon.

**0:25–0:40 — What Acrevia is**
One sentence.

**0:40–2:20 — Demonstration**
Show the transformation:
address → property truth → mission constraints → scenarios → impossible request/refusal → 3D → proof → next-step artifact.

Do not try to narrate every module.

**2:20–2:45 — Real validation + impact**
What real users/professionals said or did; one or two real measured numbers.

**2:45–3:00 — Close**
Return to the person/property from the hook and state the new outcome.

### Final — 90 seconds

Goal: make the transformation unforgettable.

A tighter structure:

**0:00–0:15** person + problem  
**0:15–0:25** Acrevia in one sentence  
**0:25–1:10** strongest visual proof: real property, mission constraint, recompute, refusal/conflict, 3D  
**1:10–1:22** proof/validation  
**1:22–1:30** impact close

Atlas/portfolio scale is a brief reveal only if it strengthens the impact close. It should not displace the human problem.

## Demonstration doctrine

The demo must show **cause and effect**.

Strong:
- change Sunday parking → scenario count / massing changes
- preserve sanctuary → feasible envelope changes
- impossible unit request → solver refuses and explains
- regulatory conflict → optimistic scenario becomes stale / invalid
- click constraint → authoritative source / derivation
- choose scenario → Council packet derives from the same state

Weak:
- click through many static pages
- narrate architecture diagrams
- show code
- show generated prose without state change
- show unrelated "AI features"
- use beautiful 3D that is disconnected from feasibility

## Judge-objection design

The product and pitch should answer likely objections before judges ask:

**"Is the zoning trustworthy?"**
→ provenance + conflict handling + expert-required state.

**"Is the 3D just generated art?"**
→ scenario geometry derives from constraints and recomputes visibly.

**"Is this just ChatGPT for real estate?"**
→ deterministic solver + Development Graph + typed tools + evidence chain.

**"Will a pastor understand it?"**
→ address-first flow + mission language + board-ready output + real-user validation.

**"Is it actually impactful?"**
→ real property, real user, measured time/decision improvement, credible pathway to more projects.

**"Can it scale?"**
→ shared substrate + Atlas reveal, without letting scale replace the human story.

## Build sequencing principle

Build the technical system deeply, but continuously ask:

> What visible user outcome does this unlock?

Every major PR should name that outcome.

## Agent-prompt standard

Every coding agent should receive:

1. README.md
2. this WINNING_STANDARD.md
3. DESIGN_CONSTITUTION.md for any user-facing work
4. DEVELOPMENT_PLAYBOOK.md
5. the exact GitHub issue
6. relevant ADRs / contracts

Before implementation, the agent should:

- summarize its understanding
- list assumptions
- identify ambiguity
- identify files/contracts likely to change
- call out any conflict with existing architecture
- ask only blocking questions

Then implement.

After implementation, use a separate critic/recovery pass.

## Final release gate

Before final demo, we should be able to answer yes to all of these:

- Does a real property work end to end?
- Can every important claim be traced?
- Does the product visibly react when a constraint changes?
- Can Acrevia refuse an attractive but impossible answer?
- Has at least one real church/ministry decision-maker tested it?
- Has at least one development professional challenged it?
- Did feedback materially change the product?
- Is the 3-minute preliminary pitch rehearsed?
- Is the 90-second finalist video ready before finalists are announced?
- Is the repository auditable?
- Does the interface look like a serious spatial product rather than AI-template SaaS?
- Can we explain Acrevia in one sentence without technical jargon?
