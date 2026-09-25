# Acrevia Two-Person Development Playbook

This is the practical operating guide for building Acrevia with two developers and coding agents.

The goal is not maximum parallelism. The goal is **safe parallelism**: both people move quickly without building incompatible versions of the product.

## The mental model

Think in dependencies.

Some issues define contracts that many later issues depend on. Those must land first.

Other issues are independent and can be developed in parallel.

Do not simply assign half the issues to each person and start all of them.

## Golden rule

**Never start an issue if the data contract it depends on is still being redesigned.**

Example:

Forge should not invent its own Scenario shape while the solver is still defining Scenario.

Copilot should not invent tool payloads before the Development Graph and solver APIs exist.

Council should not duplicate scenario metrics while Proof/ScenarioCertificate is still changing.

## Branch model

For every issue:

1. pull latest `main`
2. create a branch
3. implement one coherent issue
4. run tests/checks
5. open PR
6. other person reviews
7. fix requested changes
8. merge
9. both developers pull latest `main` before starting dependent work

Branch names:

`feat/1-foundation`
`feat/3-development-graph`
`feat/7-scenario-solver`
`fix/forge-stale-scenario`

Do not work directly on `main`.

## Daily sync

At the beginning of a work block, spend 10–15 minutes answering four questions:

1. What issue am I on?
2. What files/contracts am I likely to change?
3. Does the other person depend on those files?
4. What must land before either of us starts the next issue?

At the end of the work block:

1. push branch
2. update the issue/PR
3. note any changed contracts
4. tell the other person what is safe to build against

This avoids surprise merge conflicts and silent architecture drift.

## Recommended sequencing

### Stage A — establish truth and skeleton

Person A:
- Issue #1 Foundation

Person B:
- Issue #2 Real-property benchmark

Together:
- review and agree on Issue #3 Development Graph before implementation

Then one person implements #3 while the other finishes polishing #1/#2 and helps review #3.

Do not start GIS, solver, Copilot, or Forge until #3's core contracts are merged.

### Stage B — build the three inputs to the graph

After #3 merges:

Person A:
- #4 Address / parcel / jurisdiction

Person B:
- #6 Mission Compiler

Then:
- #5 Regulatory Compiler should be owned by whichever person is more comfortable with backend/AI/data work

The other person can continue integration/UI work on #4/#6 and begin evaluation fixtures in #16.

These three issues can overlap because they write different categories of data into the same graph.

### Stage C — build the computation core

Once the graph contains real parcel, law, and mission data:

Primary backend owner:
- #7 Scenario Solver

Other developer:
- #16 Acrevia Bench
- small product integration work around existing features

The eval developer should intentionally try to break #7 while it is being built.

This is useful parallel work, not duplicated work.

### Stage D — decide 3D before building 3D

Before Forge:

- complete #8 3D Spike
- both developers review the ADR
- make one decision
- merge the decision

Do not have one person build Snaptrude while the other builds a competing Three.js architecture.

### Stage E — spatial product + proof

After #7 and #8:

Person A:
- #9 Forge

Person B:
- #11 Proof / Evidence

They can run in parallel because both consume Scenario + Evidence contracts.

Sync frequently if either needs schema changes.

Do not modify the core Scenario schema inside a UI PR without discussing it first.

### Stage F — integrate AI interaction

After #4/#5/#6/#7/#11 are stable enough:

- #10 Copilot

Copilot comes later intentionally.

If built too early, it will become a fake chatbot because there are no real tools for it to invoke.

At this stage its tools should call working property, mission, solver, and evidence systems.

### Stage G — extra-mile challenge features

Once the hero workflow is genuinely working:

Parallelize:
- #12 Capital
- #13 Council

Then:
- #14 Atlas

Atlas should reuse the same property/project flows; it should not become a second fake app.

### Stage H — visual unification

Issue #15 is not a one-time "make it pretty" task.

Treat it as two passes:

Pass 1 early:
- design tokens
- landing skeleton
- navigation
- address entry
- workspace structure

Pass 2 after Forge/Proof/Copilot:
- replace placeholders with real product states
- refine transitions
- normalize all screens
- final responsive polish
- remove generic AI-template artifacts

Every user-facing issue must also follow `docs/DESIGN_CONSTITUTION.md`.

### Stage I — demo hardening

#18 happens continuously at low intensity but becomes the final integration focus.

By final hardening:
- one-click reset
- benchmark data cached
- no fake numbers
- no broken external dependency can destroy the demo
- every screen in the 90-second path is polished
- all claims match current implementation

## Contract ownership

For a two-person team, use temporary ownership areas.

Suggested default:

### Developer A — application / spatial experience
- Next.js shell
- map/3D
- Forge
- landing/product UX
- Council presentation experience

### Developer B — intelligence / truth systems
- benchmark
- GIS/data pipelines
- regulatory compiler
- solver
- evidence
- evals

Shared:
- Development Graph
- Mission schema
- Copilot tool contracts
- Capital model
- demo integration

Ownership means "first reviewer and primary implementer," not exclusive access.

If your strengths differ, swap areas — but keep ownership explicit.

## When two issues can run in parallel

Safe parallel example:

#4 GIS and #6 Mission Compiler

They both depend on #3, but they mostly touch different inputs.

Unsafe parallel example:

#7 Solver and #9 Forge before Scenario is stable

Forge would guess what the solver outputs and both PRs would fight.

## How to use coding agents

For each issue, the agent gets:

1. the current repo
2. the issue
3. README.md
4. relevant ADRs/docs
5. DESIGN_CONSTITUTION.md if user-facing

Do not paste every conversation into every prompt.

Longer context is not automatically better. The issue should contain local requirements; shared docs contain global requirements.

After first pass, use the issue's Recovery / Critique prompt.

If still weak, a second agent should review the implementation against the issue without editing it. Feed the resulting concrete findings back to the implementer.

## What requires a human conversation before merging

Stop and sync if a PR changes:

- core Scenario fields
- Constraint status semantics
- Development Graph relationships
- database schema used by another active branch
- public API contract
- 3D engine choice
- verification-state language
- authentication/project identity model

A five-minute conversation is cheaper than a two-hour merge repair.

## Merge order

If two dependent PRs are open:

1. merge the lower-level contract/data PR first
2. update/rebase the dependent branch
3. run tests again
4. repair integration
5. then merge the dependent PR

Do not merge both independently and hope Git resolves semantics.

## Definition of "done"

An issue is done only when:

- acceptance criteria pass
- tests pass
- UI states are complete where applicable
- product behavior is understandable without developer explanation
- no hidden fake data is presented as computed truth
- docs/ADR updated when contracts changed
- another team member has reviewed it
- `main` remains demoable after merge

## First concrete move

Right now:

1. Developer A takes #1.
2. Developer B takes #2.
3. Both read README + this playbook + Design Constitution.
4. Before either starts a dependent feature, both review #3 together.
5. Merge #1/#2 as soon as each is solid.
6. Implement and merge #3.
7. Only then fan out to #4/#6 and then #5.

That sequence gives you speed without building two incompatible Acrevias.
