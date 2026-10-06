# ADR 0005 — Mission Compiler: deterministic interpretation and the verified project-state bridge

Status: proposed with issue #6.

## Context

Issue #6 turns post-acceptance intent into canonical project state. After the
GIS flow commits a Development Graph project, Acrevia asks what the church
refuses to lose; direct controls and one natural-language sentence become
typed, inspectable proposals; only explicit confirmation writes
`MissionConstraint` nodes. The PR #25 trust model left the committed Project
JSON client-discarded and the server stateless — mission editing needed a
trustworthy path back to a mutable project without a database or a parallel
client truth model.

## Decisions

1. **No `MissionNormalized` extension.** The five executable types
   (min-parking, preserve-structure, max-stories, retain-ownership,
   max-height) remain the union. Affordability, income, disruption, and
   abstract ministry-preservation goals are surfaced as needs-clarification /
   not-executable-yet — honest limbo, not fake types whose semantics the
   solver (#7) could not honor. `preserve-structure` covers any resolved
   building; when several exist the interpreter asks rather than choosing.

2. **Deterministic typed parser, not a model.** `interpretMission()` is a
   documented regex grammar over clause-split input with structure context,
   returning Zod-validated `{ proposals, needsClarification, unsupported,
   conflicts }`. Fuzzy input ("parking is important") never yields a value;
   contradictory ownership language yields a conflict and suppresses both
   readings; extreme-but-positive quantities stay valid with an explicit
   "feasibility has not been tested yet" note — impossibility is the #7
   solver's claim to make. Interior ministry areas (a food pantry, kitchen,
   classrooms) are never silently mapped onto a whole resolved building —
   they map only when a resolved structure genuinely identifies them by
   name, otherwise they need clarification. The boundary is adapter-shaped
   so #10 Copilot can add model-backed interpretation behind the same
   contract. The parser is never labeled AI.

3. **Proposal → explicit confirmation, always.** Parser output writes
   nothing. `confirmMissionConstraint` remains the only path into
   `project.nodes`, and its input schema is CONFIRMED-only
   (`MissionConstraintConfirmation`): a DRAFT payload cannot pass the
   command boundary no matter who sends it. Origin is enforced
   USER_DECLARED, and proposal ids are deterministic per semantic slot
   (e.g. `mission:min-sunday-parking`) so editing a value upserts the same
   constraint and advances revision. `preserve-structure` rules must
   reference the canonical Development Graph structure node
   (`gis:structure:<id>`); the command enforces referential integrity via
   `requireNode(..., "structure")`, and the map renderer adapts canonical
   graph ids back to raw GIS ids for drawing — the domain contract stays
   canonical. Mission inputs carry no evidence state and are never
   displayed as externally verified facts.

4. **Semantic value validation on the schema.** `MissionNormalizedChecked`
   rejects negative/zero/fractional spaces, zero/negative stories, and
   non-positive/non-finite heights at the command boundary — typed units
   alone were not enough.

5. **`retractMissionConstraint` typed command.** Removes the node and its
   edges in one audited `mission.constraint.retracted` event; certificates
   whose closure included the rule grade INVALIDATED via the existing
   staleness refresh.

6. **Verified project-state bridge — `POST /api/mission/state`.** The
   smallest trust-preserving bridge from the accepted session to a mutable
   project:
   - verify the stored `{ envelope, receipt }` pair exactly as
     `/api/gis/verify` does (both HMACs + mutual consistency);
   - reconstruct the committed project deterministically — `commitSession`
     is a pure function of the verified session, rebuilt with
     `now = receipt.committedAt` (the commit route uses ONE `commitNow`
     timestamp for both the commit and the receipt, so reconstruction
     reproduces the committed bytes exactly);
   - hash gate: SHA-256 of the rebuilt encoded base project must equal the
     `projectHash` signed into the CommitReceipt at commit time (which also
     carries a stable `commitVersion`); any drift fails closed (409,
     re-accept required) rather than silently rebuilding a different base;
   - replay the client-held mission command log through the typed command
     boundary; each event (confirm AND retract) is stamped with the
     command's own user-declared `declaredAt` (never wall-clock), so
     identical logs yield byte-identical projects and audited timestamps
     reflect when the user actually acted;
   - `ProjectCodec.encode()` integrity gate;
   - return the project with an HMAC attestation binding
     `{ projectId, envelopeSignature, commandCount, revision, projectHash }`.

   The client stores the signed pair (unchanged, exactly `{ envelope,
   receipt }`) plus a separate unsigned mission command log — user intent,
   not truth: the server re-validates every command at each replay, and a
   "forged" mission command is only ever a choice the user could have made
   in the UI. The log is BOUND to the accepted base project
   (`{ projectId, envelopeSignature, commands }`): a log from a different
   property — or from an earlier acceptance of the same one — is discarded
   on read, and a newly accepted pair clears the previous property's log,
   so mission state can never leak across properties. External facts
   (zoning, owner, geometry) remain locked inside the signed envelope. No
   database, no server-side persistence, no client-authored project JSON is
   ever rendered.

7. **Map binding.** A confirmed `preserve-structure` rule marks the real
   resolved footprint on the canvas (`data-mission-protected` in the SVG
   fallback; olive styling in the MapLibre path), so the sanctuary the
   congregation refused to lose reads directly on the property.

## Consequences

- Mission state is session-scoped exactly like the accepted property; reload
  reconstructs it through verification (proven by e2e).
- Dependent scenario certificates stale when mission rules change or retract
  (regression in `tests/domain/invalidation.test.ts` with an unrelated
  certificate remaining CURRENT).
- #7 Solver consumes these MissionConstraint nodes as hard/soft inputs.
- #10 Copilot may upgrade interpretation richness behind the same typed
  boundary without changing the confirmation discipline.
