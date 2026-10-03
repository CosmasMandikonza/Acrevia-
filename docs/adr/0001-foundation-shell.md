# ADR 0001 — Application foundation

Status: proposed for review with issue #1.

## Outcome and scope

A church leader can enter an address, open a spatially centered workspace, and
navigate Portfolio, Site, Scenarios, Capital, Council, and Evidence. The shell
makes its incomplete capabilities explicit. It does not perform property lookup
or produce feasibility, regulatory, financial, or scenario conclusions.

## Decisions

- Use Next.js App Router and strict TypeScript in a single application at the
  repository root. This is sufficient for the first shell; a monorepo would add
  coordination cost without a second implemented service.
- Use Tailwind v4 with centralized CSS tokens and bespoke semantic layout styles.
  The local Button follows shadcn's Slot/CVA composition pattern. Radix Dialog
  supplies the Copilot rail's modal semantics, focus trap, Escape handling, and
  focus restoration. `components.json` supports later local shadcn additions.
- Keep the URL as the sole source for the entered address and selected surface.
  Address text is trimmed, length limited and encoded, not geocoded or verified.
  It survives refresh and navigation, but is not saved in a database. Addresses
  are visible in browser history and URLs; do not enter private information.
- Limit local React state to form validation and opening feedback. The shell does
  not invent Project, Scenario, Constraint, or Evidence contracts. Issue #3 owns
  the canonical Development Graph. The UI URL is not a future project identity.
- Isolate the spatial viewport and Copilot components so later implementations can
  consume the canonical model rather than maintaining competing project state.
- Provide empty/loading/error/stale presentation primitives, a route loading
  boundary, a recoverable workspace error boundary, and a 404 recovery page.
  Stale is tested as a reusable primitive; there are no results to invalidate yet.
- Keep the Copilot rail closed until requested to preserve the canvas. It behaves
  as an accessible modal side panel on every viewport, with messaging disabled.
- Use an original SVG concept illustration on the landing page. Its geometry is
  editorial artwork, not property data or solver output; both its caption and
  accessible description disclose this. The workspace starts empty.

## Deferred integration boundaries

| Boundary | Owner / intended direction | Foundation behavior |
| --- | --- | --- |
| Shared domain model | #3 Development Graph | No speculative domain types |
| Parcel and jurisdiction lookup | #4, future MapLibre view | Address capture and empty viewport |
| GIS/solver service | Future Python/FastAPI service | No API endpoints or invented payloads |
| Persistence | Future PostgreSQL/PostGIS | No connection, schema, auth, or project IDs |
| Spatial renderer | #8 evaluation, then #9 Forge | Renderer-neutral HTML canvas container |
| Copilot tools | #10 | Accessible rail with disabled composer |
| Evidence | #11 | Honest unpopulated evidence strip |

Issue #1 suggests React Three Fiber/Three.js for prototyping, while the playbook
requires a reviewed #8 decision before Forge. Because #1 only needs a placeholder,
no map or 3D runtime is installed and no engine choice is made here.

## Validation

Vitest/Testing Library cover address handling, recovery actions, and view states.
Playwright checks the production app at desktop, laptop, and mobile sizes, including
navigation, refresh, keyboard focus, no horizontal page overflow, console errors,
and automated accessibility checks. Screenshots accompany the PR. Automated CI
is deferred because the current GitHub sign-in cannot create workflow files.
These checks validate the shell only,
not future property analysis or professional suitability.

## Dependency audit note (2026-10-02)

`npm audit --omit=dev` reports zero vulnerabilities. The full audit reports five
high-severity entries along one development-only chain:
`eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`.
The underlying advisory is GHSA-vfj7-8cjw-p6xm (deeply nested glob patterns can
exhaust the stack). The latest published `braces` is still 3.0.3. npm's suggested
fix downgrades the Next lint configuration to 14.2.35, which is not a suitable fix
for this Next 16 foundation. The application does not accept user-supplied lint
glob patterns. Keep this documented until the upstream toolchain has a compatible
fix; do not silently force a major downgrade or mark the full audit clean.
