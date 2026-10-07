# ADR 0012 — Capital: a thin deterministic view over trusted scenario truth

Status: accepted with issue #12.

## Context

The challenge offers bonus credit for an illustrative financing sketch. The
failure mode Acrevia refuses is a finance platform: invented program facts,
hidden lender math, accidental LIHTC eligibility claims, numbers a judge
cannot trace. The repo already has the hard part — a deterministic solver
whose scenarios carry ScenarioCertificates pinning their exact dependency
closure, rebuilt per request from a signed accepted pair (ADRs 0007, 0011).
Capital only has to make trade-offs visible on top of that truth.

## Decisions

1. **One pure engine, one route, one surface.**
   `application/capital/schema.ts` (typed assumptions + pathway presets,
   client-safe), `application/capital/calculate.ts` (the only calculation
   code), `POST /api/capital/evaluate` (the only endpoint), and
   `components/capital/capital-explorer.tsx` (the only surface). No
   persistence, no capital history, no new project model: every request
   recomputes.

2. **Trust boundary is the shared pipeline, not a new one.** The route calls
   `buildTrustedProofContext` — the same verify/hash-gate/compile/replay/
   solve path as `/api/proof/snapshot` and the Copilot. Capital evaluates
   only a scenario the CURRENT rebuild just recorded with a CURRENT
   certificate; anything else fails closed (`stale-scenario` /
   `stale-certificate`). A foreign or historical scenario id never falls
   back silently.

3. **Ownership pathways are presets, not engines.** `ground-lease`,
   `church-led`, `joint-development` each override a small explicit set of
   defaults (land treatment, church/partner contributions, debt) plus
   explanatory text. The math is identical; switching a pathway restores its
   preset assumptions, so pathway economics are attributable to the exact
   assumption deltas shown on screen.

4. **Assumptions are the only unverified inputs, by design.** A bounded,
   ordered registry (labels, units, rationale, min/max) is the single source
   for the zod schema, the API response, and the UI editor. Every assumption
   is editable and PRELIMINARY-labeled. Acrevia asserts NO public-program
   facts: grants/subsidy and other funding are unattributed placeholders, and
   the EXPERT REQUIRED list is derived deterministically from state (gap > 0,
   grants > 0, pathway-specific terms) — that is how the issue's
   evidence/source criterion is satisfied: explicit non-assertion plus a
   professional-sourcing boundary, never invented program data.

5. **Sensitivity is deterministic comparison, not simulation.** Four
   variants (hard cost +10%, revenue −10%, occupancy −5 pts, affordability
   +10 pts) each re-evaluate the SAME engine with exactly one assumption
   moved; no distributions, no Monte Carlo, no sliders that run models.

6. **Freshness is a fingerprint, not a version store.**
   `capitalFingerprint` hashes scenario id + certificate id + engine version
   - pathway + normalized assumptions (canonical JSON, no timestamps). It
     changes iff the trusted scenario/certificate identity or an assumption
     changed — which is exactly the issue's staleness criterion, with nothing
     persisted. The Council projection is a set of sentences derived inside
     the same evaluation from the same numbers, so council-facing output
     necessarily propagates every change.

## Consequences

- The surface shows cost stack vs identified capital, funding gap,
  affordability's effect on revenue/NOI, sensitivity, expert boundaries, and
  a council-readable projection — every number traceable to one formula in
  `calculate.ts` over certificate-pinned scenario facts plus labeled
  assumptions.
- Adding a new assumption or sensitivity variant is a registry/preset edit
  in one module; nothing else in the system knows about capital specifics.
- What Capital deliberately cannot do: underwrite debt, model taxes or
  program rules, value ground rent, or advise. Those live in EXPERT
  REQUIRED, which is the product boundary, not a gap.
