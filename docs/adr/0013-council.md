# ADR 0013 — Council: five audiences, one fact table, zero narrative drift

Status: accepted with issue #13.

## Context

The challenge gives bonus credit for faith-aligned community presentation
materials and a one-click council-ready export. The failure mode Acrevia
refuses is five independently written narratives for five audiences — a
pastor deck, a city deck, and a neighbor flyer that quietly disagree about
homes, parking, or height the moment the model moves. The repo already has
the hard part: one trusted rebuild (`buildTrustedProofContext`) that turns a
signed accepted pair into certified scenario truth (ADRs 0011, 0012), plus
Capital's deterministic money view. Council only has to present that truth
without ever re-authoring it.

## Decisions

1. **One deterministic assembly, one route, one surface, one export.**
   `application/council/package.ts` (the only assembly code — pure over one
   ready `TrustedProofContext`), `POST /api/council/package` (the only
   endpoint, discipline identical to `/api/capital/evaluate`),
   `components/council/council-room.tsx` (the only surface), and
   `components/council/deck.ts` + `plan-svg.ts` (the only export path). No
   persistence, no second content store, no comments, no slide editor: the
   package is recomputed per request.

2. **The audience invariant is structural, not editorial.** The package
   ships ONE `facts` table; every audience view is a template that may only
   interpolate formatted values from that table (emphasis references
   `factKey`s). Switching audiences is a client-side reframe of the same
   payload — no refetch, so the room visibly cannot drift, and the test
   suite asserts no audience copy ever contradicts the fact table
   (`tests/council/package.test.ts`, "THE invariant").

3. **Council never presents stale truth.** A foreign scenario id fails
   closed as `stale-scenario`; a non-CURRENT certificate fails closed as
   `stale-certificate` — both return the current scenario list for
   recovery. Council refuses to ship a package labeled STALE to a stakeholder;
   recompute happens on the solver surface first.

4. **Capital is folded in by the assembly, not the route.** When a pathway
   is supplied, the SAME scenario the package selects is evaluated by the
   same pure Capital engine inside the assembly, and the Capital fingerprint
   joins the package fingerprint. Selection happens exactly once, so money
   and narrative can never describe different scenarios. No pathway →
   `capital: null` with an explicit pointer, never silence.

5. **Package fingerprint = semantic identity, no timestamps.**
   `sha256(canonicalJson({ packageVersion, projectId, projectRevision,
scenarioId, certificateId, certificateHash, sorted mission revisions,
capitalFingerprint | null }))`. Audience is deliberately NOT hashed: the
   fingerprint identifies the facts, and framing is not a fact. Change the
   scenario, a mission rule, or a capital input and every previously
   exported deck is visibly no longer CURRENT.

6. **AI is not in the loop.** Audience copy is deterministic templates.
   The Copilot's board brief (`prepare_board_context`) remains the
   AI-assisted path; Council works fully with no provider configured, and
   no number can originate from an LLM.

7. **The export is a self-contained 16:9 HTML deck.** One click writes a
   deterministic file (identical inputs → identical bytes) styled as
   1280×720 slides: audience framing up front, the full fact/scenario/
   mission/capital story, the conceptual site plan and Forge saved views,
   then assumptions, conflicts, expert-required items, the next decision,
   and every citation. Readable without the live app; Print → PDF yields
   one slide per page. The plan frame is a pure SVG projection of the SAME
   `SpatialSceneModel` Forge renders (ADR 0008 boundary); if the scene is
   unavailable the package stands and says so.

## Consequences

- The `stakeholder-view` audience vocabulary (`pastoral | board | neighbor |
council | professional`) is now used by a real surface; persisting
  stakeholder-view nodes remains future work and would layer on the same
  assembly.
- Multi-parcel, unsupported-district, and needs-evidence states return the
  same honest shapes as Capital — Council inherits every gate.
- Screenshots of Forge views are NOT included: no image-export
  infrastructure exists. Saved views enter as deterministic camera
  metadata plus the plan projection; adding PNG capture later requires no
  contract change here.
