# AGENTS.md — Acrevia engineering instructions

This repository is being built for a highly competitive AI hackathon. Do not optimize for merely functional output.

## Required reading before implementation

Read, in this order:

1. `README.md`
2. `docs/WINNING_STANDARD.md`
3. `docs/DESIGN_CONSTITUTION.md` for any user-facing work
4. `docs/DEVELOPMENT_PLAYBOOK.md`
5. the exact GitHub issue being implemented
6. relevant ADRs and existing domain contracts

## Before touching code

First inspect the current `main` branch and return a short preflight with:

- your understanding of the issue
- dependencies that must already exist
- assumptions you are making
- ambiguities or conflicts
- files/contracts you expect to change
- tests/evals you will add
- the visible user outcome this unlocks

Ask only genuinely blocking questions. Do not begin large rewrites before this preflight is coherent.

## Implementation rules

- Work one issue at a time.
- Branch from latest `main`.
- Do not create parallel sources of project truth.
- Do not hard-code demo metrics and present them as computed outputs.
- Use deterministic software for geometry, arithmetic, validation, optimization, and constraint checking.
- Use AI for interpretation, orchestration, language, and ambiguity where AI is actually necessary.
- Every consequential regulatory claim needs provenance.
- Preserve explicit states such as VERIFIED / ASSUMPTION / CONFLICT / EXPERT REQUIRED / STALE.
- Do not silently guess when evidence is missing.
- User-facing work must satisfy the Design Constitution.
- Do not rewrite unrelated working code.
- If a core contract needs to change, explain why before changing it.

## Quality bar

The product should feel like serious spatial / AEC software, not an AI hackathon template.

A PR is not done because the page renders. It is done only when:

- acceptance criteria pass
- tests/evals pass
- loading / empty / error / stale states exist where relevant
- important outputs derive from real state
- failure behavior is safe and understandable
- no mock is presented as real
- the feature integrates with the Development Graph
- the visible UX is coherent with Acrevia's end-to-end story
- documentation/ADR is updated when architecture changes

## Agent workflow

For each issue:

1. preflight
2. implement
3. run checks
4. self-critique against the issue + WINNING_STANDARD
5. fix gaps
6. open a PR using the repo PR template

The PR must include exact test steps, evidence, edge cases, what is mocked/deferred, and `Closes #N`.

## No-slop check

Before finishing, ask:

- Does this look or behave generic?
- Did I invent a new local state model instead of using shared contracts?
- Are any visible numbers fake or unexplained?
- Would a skeptical judge be able to trace the important result?
- Does this survive an edge/failure case?
- Does this help a real church move toward a credible development decision?

If any answer is weak, improve it before declaring completion.
