---
name: Acrevia implementation issue
about: Repo-aware implementation brief for a product slice
title: "[P0][Area] "
labels: ""
assignees: ""
---

## Why this exists

Explain the user/problem/judging reason this work matters.

## Required shared context

Before implementation, read:

- `README.md`
- `docs/WINNING_STANDARD.md`
- `docs/DEVELOPMENT_PLAYBOOK.md`
- `docs/DESIGN_CONSTITUTION.md` for any user-facing work
- relevant ADRs / domain contracts

## Product outcome

Describe what a user can do when this issue is complete.

## Technical contract

List the existing domain objects/APIs this work consumes and produces.

## Required behavior

- [ ]
- [ ]

## Edge cases

-
-

## Acceptance criteria

- [ ] Works against current repo state
- [ ] Loading / empty / failure states handled
- [ ] Tests added or updated
- [ ] No hard-coded demo truth
- [ ] No duplicated project state
- [ ] Important metrics derive from real state
- [ ] User-facing work passes the Design Constitution
- [ ] Feature advances challenge fit, impact, innovation, AI depth, trust, or presentation
- [ ] README / ADR updated if architecture changes

## Demo test

Describe the exact visible behavior a judge/user should be able to observe.

## Coding-agent preflight

Before editing, the coding agent must:

1. summarize its understanding of the issue
2. list assumptions
3. identify ambiguous requirements
4. name the files/contracts it expects to change
5. flag conflicts with current architecture
6. ask only genuinely blocking questions

## Coding-agent implementation prompt

> Read README.md, docs/WINNING_STANDARD.md, docs/DEVELOPMENT_PLAYBOOK.md, this issue, the current repository, and docs/DESIGN_CONSTITUTION.md when user-facing. Inspect existing contracts and implementation first. Before editing, summarize your understanding, assumptions, ambiguities, and planned contract/file changes. Then implement this issue without creating parallel state or unrelated rewrites. Use deterministic code for arithmetic/geometry/validation. Use AI only where interpretation, orchestration, or language is actually required. Handle the listed edge cases, add tests, run all checks, and report what changed plus anything intentionally deferred.

## Recovery / critique prompt

> Audit the existing implementation as a skeptical hackathon judge and senior engineer against this issue plus docs/WINNING_STANDARD.md. First list concrete gaps, incorrect assumptions, hidden mocks, stale state, missing edge cases, generic UI, architectural drift, and places where the implementation looks impressive but is not actually derived from real project state. Add failing tests where possible, fix the gaps without rewriting unrelated working code, run all checks, and report remaining risks.

## PR evidence required

- Screenshot / recording where UI is involved
- Test output
- Exact manual test steps
- What is mocked or deferred
- Which visible user outcome this PR unlocks
- `Closes #N` in the PR body
