# Acrevia Design Constitution

Acrevia should look and behave like a serious spatial development product that could plausibly be used by churches, planners, housing developers, and real-estate professionals after the hackathon.

This document is a **global constraint** for every UI issue. A coding agent should read it before changing any user-facing screen.

## Product feeling

**Editorial architecture + computational precision.**

The product should communicate two things at once:

1. **Possibility** — a church should be able to imagine what its property could become.
2. **Trust** — every important claim should feel inspectable, sourced, and technically grounded.

The UI should not look like a generic AI startup, chatbot wrapper, crypto dashboard, template marketplace, or hackathon prototype.

## Reference class

Use the product-thinking and interaction quality of tools such as:

- Snaptrude — connected spatial model from site to massing to presentation
- Autodesk Forma — geolocated site analysis, option comparison, environmental context
- TestFit — instant visual response when development constraints change
- Finch — rule-driven generation and option exploration
- high-end architecture / property-development editorial websites
- Figma-like shared canvas mental model for collaborative work
- Cult UI / Tempo-style components only where they improve polish without becoming visual gimmicks

We are not copying any one product. We are borrowing proven interaction patterns and quality bars.

## Non-negotiable visual rules

### Never default to AI-template styling

Do not use:

- purple/blue neon gradients as the main brand device
- glowing AI orbs
- glassmorphism everywhere
- four identical rounded feature cards in every section
- excessive pills/badges
- generic illustrations of brains, circuits, or sparkles
- huge "AI-powered" headlines
- fake testimonials or invented metrics
- random icon-per-sentence layouts
- dashboard card soup
- excessive shadows or gradients used to manufacture visual interest

### Canvas-first product

The property is the hero.

In the authenticated product, the largest area of the interface should normally be:

- map
- parcel/site geometry
- 3D development twin
- scenario visualization
- evidence-linked spatial overlays

Navigation, metrics, evidence, and Copilot support the spatial model rather than replacing it.

### Copilot is a sidecar

Copilot is not a full-screen chatbot.

Preferred interaction:

1. user changes a value directly or uses natural language
2. structured project state changes
3. solver / evidence / geometry recompute
4. the canvas visibly changes
5. Copilot briefly explains what changed and why

The visual result should carry more weight than the text response.

## Landing page

The public landing experience should feel premium and restrained.

### Hero

Primary idea:

**Your land could become homes.**

Supporting message should explain the transformation without jargon.

Primary CTA should be the product input itself:

**Enter a church address**

Avoid generic "Get started" as the only primary action.

The hero visual should communicate:

existing property
→ legal envelope
→ mission constraints
→ possible development

If a 3D/site animation is used, it should explain the product rather than exist as decoration.

### Page rhythm

Favor editorial pacing:

- strong opening statement
- large visual proof
- one idea per section
- alternating text / spatial product views
- plenty of whitespace
- short copy
- real product screens
- no 12-card feature grid

## Product workspace

Preferred desktop structure:

- slim top bar: project identity, project status, account/global actions
- left navigation: Portfolio, Site, Scenarios, Capital, Council, Evidence
- large central spatial canvas
- right contextual rail: Copilot / inspector / selected object
- bottom or compact status strip for verified / assumptions / expert review

Do not permanently display every panel. Preserve the canvas.

## Core visual layers

The user should be able to visually distinguish:

- existing site
- parcel boundary
- legal buildable envelope
- mission-constrained envelope
- scenario massing
- protected ministry areas
- parking
- setbacks
- height plane
- unresolved / invalid state

Use a small consistent visual vocabulary.

## Color

Marketing can be warmer than the app.

Suggested direction:

- warm ivory / off-white surfaces
- charcoal / near-black typography
- stone / warm gray secondary surfaces
- restrained olive / mission green accent
- amber for assumptions / caution
- rust / muted red for conflict or expert-required states

Status colors should communicate state, not decorate everything.

Do not rely on color alone for meaning.

## Typography

Marketing may combine:

- one editorial serif for high-emotion headlines
- disciplined sans-serif for body / interface

Product interface should primarily use the sans-serif.

Use monospace sparingly for evidence IDs, rule IDs, hashes, or technical provenance.

Typography hierarchy should do more work than boxes and borders.

## Shape and spacing

Avoid making every object a rounded card.

Use:

- panels where containment matters
- dividers and alignment for structure
- radius intentionally and consistently
- generous whitespace
- strong grid alignment
- compact controls inside the spatial workspace

## Motion

Motion must explain state.

Good uses:

- parcel resolves onto map
- legal envelope fades/rises in
- mission constraint removes part of feasible envelope
- scenario massing recomputes
- camera moves to a saved viewpoint
- proof chain reveals dependencies

Bad uses:

- floating cards for no reason
- constant ambient movement
- excessive parallax
- animated gradients
- motion that delays user control

## 3D quality bar

3D should never be treated as a decoration.

A scenario must come from Acrevia project state.

A change to:
- parking
- height
- setback
- protected ministry space
- scenario selection

must be capable of changing what the user sees.

Conceptual massing must be clearly labeled as preliminary and should not imply architectural approval.

## Evidence UX

Trust states should be visible but not alarming.

Use explicit language such as:

- SOURCE CONFIRMED
- MACHINE CHECKED
- ASSUMPTION
- CONFLICT
- EXPERT REQUIRED
- STALE / RECOMPUTE

Avoid language that implies legal certification unless a real professional supplied it.

A user should be able to click a consequential metric or spatial constraint and discover its derivation.

## Copy rules

Prefer:

- specific nouns
- short sentences
- concrete effects
- visible evidence

Avoid:

- "revolutionize"
- "AI-powered"
- "unlock insights"
- "seamless"
- "transformative platform"
- "leverage cutting-edge technology"

unless the phrase conveys information that cannot be stated more concretely.

## Responsive behavior

Desktop is the primary professional workspace.

Tablet/mobile must still support:
- project review
- evidence inspection
- basic scenario viewing
- board/council sharing

Do not shrink the desktop interface blindly. Collapse secondary panels and preserve the core story.

## UI definition of done

A user-facing PR is not complete until:

1. it works with real project state or an explicitly labeled fixture
2. loading / empty / error / stale states exist
3. keyboard/focus basics are handled
4. the screen works at common laptop widths
5. screenshots are reviewed for generic AI-template patterns
6. the spatial model remains visually primary where appropriate
7. no metric is present only because it looks impressive
8. copy reflects the actual current implementation
9. motion is purposeful
10. the screen could plausibly appear in a venture-backed AEC product demo

## Final self-critique prompt for UI agents

Before finishing any user-facing issue, run this critique:

> Assume this screen is competing against a team with a professional product designer and a team using a polished commercial AEC platform. Identify every part that looks templated, generic, visually noisy, under-designed, or inconsistent with a serious development-intelligence product. Check information hierarchy, typography, spacing, motion, empty/loading/error states, spatial clarity, responsiveness, and whether the most important product truth is visually obvious without narration. Fix the most important weaknesses before declaring the issue complete.
