---
name: Acrevia implementation issue
about: Repo-aware implementation brief for a product slice
title: "[P0][Area] "
labels: ""
assignees: ""
---

## Why this exists

Explain the user/problem/judging reason this work matters.

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
- [ ] README / ADR updated if architecture changes

## Demo test

Describe the exact visible behavior a judge/user should be able to observe.

## Coding-agent implementation prompt

> Read README.md, this issue, and the current repository before editing. Inspect existing contracts and implementation first. Implement this issue without creating parallel state or unrelated rewrites. Use deterministic code for arithmetic/geometry/validation. Use AI only where interpretation, orchestration, or language is actually required. Handle the listed edge cases, add tests, run all checks, and report what changed plus anything intentionally deferred.

## Recovery / critique prompt

> Audit the existing implementation against every acceptance criterion in this issue. First list concrete gaps, incorrect assumptions, hidden mocks, stale state, missing edge cases, and architectural drift. Then add failing tests where possible, fix the gaps without rewriting unrelated working code, run all checks, and report remaining risks.

## PR evidence required

- Screenshot / recording where UI is involved
- Test output
- Exact manual test steps
- What is mocked or deferred
- `Closes #N` in the PR body