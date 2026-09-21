# Acrevia

> **From land to possibility, with proof.**

**Acrevia is a development-intelligence system for faith-owned land.**  
It helps churches and faith networks understand what their property could become, test development scenarios, see the legal and mission constraints behind each option, and move from an address to a credible board- and expert-ready decision package.

Built for the **2026 Gloo AI Hackathon — Ministry Resourcing / Sacred Spaces, Safe Homes** challenge.

---

## Why Acrevia exists

Many churches own valuable, underused land: parking lots that sit empty most of the week, oversized parcels, unused buildings, or land that could support housing.

The problem is not a lack of intent.

The problem is that the first step is intimidating.

A pastor or church board may need to understand:

- What is legally possible on this parcel?
- What can physically fit?
- What happens if we preserve the sanctuary, food pantry, playground, or Sunday parking?
- Can the church keep ownership of the land?
- Which assumptions are real, which are preliminary, and which require a professional?
- What would neighbors or a city council object to?
- What should the board actually do next?

Today, those answers are scattered across zoning codes, GIS portals, spreadsheets, consultants, architectural studies, financing conversations, emails, and PDFs.

**Acrevia turns those disconnected inputs into one living development model.**

---

# The product in one sentence

> **Enter a property. Acrevia builds an evidence-backed development twin, compiles legal and mission constraints, generates valid development scenarios, and helps the church move the strongest option toward professional review.**

Acrevia is **not** intended to replace architects, planners, land-use attorneys, developers, lenders, or city officials.

It is the intelligence layer that helps a non-expert church reach the *first serious conversation* with far more clarity.

---

# The core idea: Executable Stewardship

Most real-estate software asks:

> What is the highest and best use of this land?

Acrevia asks a different question:

> **What is the highest-impact use this congregation can legally, financially, and missionally say yes to?**

That means mission requirements are not decorative text in a report.

They become first-class constraints alongside zoning, geometry, parking, ownership, affordability, and capital assumptions.

~~~text
LAW
  +
SITE
  +
MISSION
  +
CAPITAL
  +
EVIDENCE
  ↓
EXECUTABLE DEVELOPMENT MODEL
  ↓
VERIFIED SCENARIOS
~~~

---

# User flow

Acrevia is designed so a church leader can move from **"We have land"** to **"We understand the next credible step"** without becoming a real-estate expert.

~~~mermaid
flowchart TD
    A[Enter church address] --> B[Resolve parcel + jurisdiction]
    B --> C[Collect zoning + public property evidence]
    C --> D[Build Development Twin]
    D --> E[Capture Mission Constraints]
    E --> F[Generate Feasible Scenarios]
    F --> G[Explore in 2D / 3D]
    G --> H[Verify every important claim]
    H --> I[Model preliminary capital pathways]
    I --> J[Prepare Board / Council view]
    J --> K[Generate expert handoff package]
    K --> L[Watch for future changes]
~~~

## 1. Start with an address

The main entry point is intentionally simple:

**Enter a church address.**

Acrevia resolves:

- parcel geometry,
- existing structures,
- jurisdiction,
- zoning district,
- overlays,
- relevant public records,
- authoritative code sources,
- and available parcel context.

The first screen should feel like a property coming alive — not a chatbot opening a conversation.

---

## 2. Build the Development Twin

Acrevia converts the property into a shared computational model.

The Development Twin contains:

~~~text
PROPERTY
├── parcel
├── existing buildings
├── parking
├── access
├── ministry spaces
└── site geometry

LAW
├── permitted uses
├── setbacks
├── height
├── lot coverage
├── parking rules
├── overlays
└── relevant exceptions

MISSION
├── preserve sanctuary
├── preserve ministries
├── retain land ownership
├── minimum Sunday parking
├── affordability goals
└── congregation priorities

CAPITAL
├── preliminary costs
├── ownership structure
├── possible funding pathways
└── assumptions

EVIDENCE
├── source
├── code section
├── effective date
├── retrieval time
├── confidence
└── verification state
~~~

The Twin becomes the shared state for the entire product.

If a mission constraint changes in one part of Acrevia, every downstream result changes with it.

---

## 3. Capture what the congregation will not compromise

Before Acrevia proposes development, it asks the people who own the land what matters.

Examples:

- **Preserve the sanctuary**
- **Do not sell the land**
- **Keep at least 100 Sunday parking spaces**
- **Preserve the food pantry**
- **Prioritize affordable housing**
- **Keep the development below three stories**
- **Create long-term income for the church**

This becomes the **Mission Compiler**.

Natural-language priorities are translated into structured constraints the scenario engine can use.

---

## 4. Generate multiple valid futures

Acrevia does not pretend there is one magical "best" answer.

It generates alternatives that expose trade-offs.

| Scenario | Homes | Sunday Parking | Ownership | Complexity |
|---|---:|---:|---|---|
| Preserve | 22 | 108 | Church retained | Lower |
| Balance | 34 | 86 | Ground lease | Moderate |
| Community | 41 + shared space | 78 | Church retained | Moderate |
| Maximum Impact | 53 | 68 | Flexible | Higher / variance |

The point is not to choose for the church.

The point is to make trade-offs understandable.

---

# Acrevia Forge — the 3D development environment

The challenge calls for a visual massing render.

Acrevia goes further.

**Forge** is an interactive, constraint-derived 3D development environment.

The 3D model is not generated from a visual prompt.

It is produced from the same project constraints used by the feasibility engine.

~~~mermaid
flowchart LR
    A[Authoritative rules] --> B[Typed constraints]
    C[Mission constraints] --> B
    D[Parcel geometry] --> B
    B --> E[Scenario solver]
    E --> F[Valid buildable geometry]
    F --> G[Interactive 3D Twin]
~~~

In Forge, a user can:

- show the existing site,
- reveal the legal buildable envelope,
- reveal the mission-constrained envelope,
- switch between scenarios,
- inspect setbacks and height planes,
- change retained parking,
- compare before / after,
- move between aerial and pedestrian views,
- inspect a scenario from a neighbor perspective,
- and create saved views for a board or council presentation.

### Example interaction

A church leader says:

> Keep 110 Sunday parking spaces.

Acrevia does not answer with a paragraph.

The model changes.

The building massing shrinks.

The unit count recalculates.

Acrevia reports:

> **Parking is now the binding constraint.  
> Balanced scenario changed from 34 → 26 homes.**

That is the role of the Copilot: **change the model, not merely talk about it.**

---

# Acrevia Copilot

The challenge asks for an AI-driven **Feasibility & Visioning Copilot**.

In Acrevia, the Copilot is a sidecar to the spatial product — not the product itself.

Examples:

> "Keep the sanctuary and at least 90 parking spaces."

> "Show me the strongest scenario that keeps church ownership."

> "Why can't 60 apartments fit here?"

> "What changed when I increased affordability to 100%?"

> "Prepare this option for a board discussion."

The Copilot can:

- interpret natural-language goals,
- orchestrate property and regulatory research,
- translate ambiguous rules into candidate structured constraints,
- explain trade-offs,
- detect unresolved issues,
- help critique scenarios,
- and produce audience-specific narratives.

But deterministic systems handle tasks that should not be guessed:

- geometry,
- unit arithmetic,
- constraint checking,
- parking counts,
- scenario metrics,
- and financial calculations.

> **AI proposes and interprets. Deterministic systems verify. Humans authorize.**

---

# Acrevia Proof — every important claim should be inspectable

Acrevia is designed around a simple reliability rule:

> **No uncited regulation enters the solver. No generated number becomes truth because an LLM said it.**

Every consequential claim is classified as one of three states:

### VERIFIED

Supported by an authoritative source and successfully applied by the system.

### ASSUMPTION

A preliminary planning, design, or financial input required to model possibilities.

### EXPERT REQUIRED

An issue Acrevia refuses to resolve autonomously because it requires professional or official judgment.

Example:

~~~text
34 HOMES — DERIVATION

Parcel area                 76,418 ft²
Existing sanctuary         -18,223 ft²
Protected ministry space    -4,200 ft²
Front setback                   20 ft
Side setback                    10 ft
Maximum verified height         45 ft
Sunday parking retained          86

Result
Preliminary scenario: 34 homes

Evidence state
✓ 3 regulatory constraints verified
• 1 planning assumption
! Utility capacity requires expert review
~~~

---

# Adversarial reliability

Acrevia should be impressive when everything works.

It should be **more impressive when something goes wrong**.

### Impossible request

User:

> Build 70 homes and preserve all 120 parking spaces.

Acrevia:

~~~text
NO VERIFIED SOLUTION

Binding constraints:
1. Parking reserve
2. Maximum height
3. Lot coverage

Closest verified alternatives:

48 homes — 120 parking — no variance
61 homes — 84 parking — no variance
70 homes — 84 parking — height variance required
~~~

### Conflicting regulation

If two sources disagree:

~~~text
REGULATORY CONFLICT

55 ft
Older planning memo

45 ft
Current municipal code

Acrevia will not use the 55 ft assumption.

41-home scenario rejected.
Human verification requested.
~~~

Acrevia is designed to **prove opportunity — or explain why it cannot yet be proven.**

---

# Product surfaces

The user-facing product is organized around a small number of clear surfaces.

## Portfolio

For denominations, dioceses, networks, and other multi-property organizations.

Screen many properties and identify where deeper feasibility work may be worth doing.

~~~text
642 properties
    ↓
underused-land signals
    ↓
residential compatibility
    ↓
development pathway
    ↓
mission + financial fit
    ↓
priority properties for diligence
~~~

## Site

The live Development Twin.

Existing property, parcel, buildings, zoning, mission constraints, and evidence.

## Scenarios

Acrevia Forge.

Generate, compare, inspect, and modify physically and legally plausible development scenarios.

## Capital

Preliminary ownership and financing exploration.

Examples may include ground-lease structures, faith-based housing funds, or affordable-housing capital pathways where appropriate.

All financial outputs remain explicitly preliminary.

## Council

A shared decision and storytelling surface for:

- pastors,
- boards,
- neighbors,
- planners,
- councils,
- developers,
- and advisors.

The facts do not change between audiences.

The explanation does.

## Evidence

The project's source of truth.

Every regulation, assumption, conflict, unresolved issue, and expert-review requirement lives here.

## Watch

A living project should not become stale the day its feasibility PDF is exported.

Watch is designed to re-evaluate projects when relevant regulations, programs, or assumptions change.

---

# One model, multiple perspectives

Acrevia should be able to turn the same verified project into different guided experiences.

### Pastor view

What remains?  
What changes?  
What does this mean for ministry?

### Board view

What are the trade-offs?  
What risks remain?  
What decision is actually being requested?

### Neighbor view

How tall is it?  
What happens to parking?  
What changes at street level?  
What community benefit is proposed?

### City / council view

What is being proposed?  
What is the zoning basis?  
What remains uncertain?  
What public benefit is created?

### Professional view

What assumptions were used?  
Which code sections matter?  
What geometry was generated?  
What questions require expert diligence?

One Development Twin.  
Different explanations.

---

# System architecture

Acrevia is intentionally not an "LLM does everything" system.

~~~mermaid
flowchart TB
    A[Address / Portfolio] --> B[Property + Jurisdiction Resolver]

    B --> C1[Parcel / GIS Sources]
    B --> C2[Authoritative Regulatory Sources]
    B --> C3[Existing Site Data]

    C2 --> D[Regulation Compiler]
    D --> E[Candidate Rule Graph]

    E --> F1[Source Verification]
    E --> F2[Conflict Detection]
    E --> F3[Staleness / Uncertainty Checks]

    C1 --> G[Development Graph]
    C3 --> G
    F1 --> G
    F2 --> G
    F3 --> G

    H[Mission Compiler] --> G

    G --> I1[Geometry + Constraint Solver]
    G --> I2[Capital Engine]
    G --> I3[Risk / Evidence Engine]

    I1 --> J[Scenario Engine]
    I2 --> J
    I3 --> J

    J --> K1[Forge 3D]
    J --> K2[Copilot]
    J --> K3[Council]
    J --> K4[Expert Handoff]

    K1 --> L[Living Project State]
    K2 --> L
    K3 --> L
    K4 --> L

    L --> M[Watch / Re-evaluation]
    M --> G
~~~

---

# The Development Graph

The Development Graph is Acrevia's shared substrate.

It represents the relationships between:

- property,
- regulations,
- geometry,
- mission constraints,
- capital assumptions,
- stakeholders,
- evidence,
- scenarios,
- decisions,
- and future actions.

Every Acrevia product reads from and writes to this shared state.

That means:

> Change one constraint → the entire project updates.

No disconnected AI-generated reports.

No contradictory spreadsheets.

No presentation slide with numbers that no longer match the model.

---

# Human-in-the-loop by architecture

Acrevia separates what AI can assist with from what must remain a human decision.

### Acrevia may

- collect public information,
- interpret and structure candidate regulations,
- generate preliminary scenarios,
- calculate modeled outcomes,
- explain trade-offs,
- prepare drafts,
- identify missing information,
- and prepare expert questions.

### Human confirmation / professional review is required for

- final legal conclusions,
- final financial decisions,
- permit submissions,
- binding commitments,
- official public statements,
- contracts,
- and other consequential actions.

The product should make these boundaries visible in the interface — not bury them in a footer.

---

# Challenge fit

Acrevia is being built specifically around the **Sacred Spaces, Safe Homes** success test:

> A non-expert church leader should be able to move from an address to a credible preliminary feasibility view and a presentation they could actually take to a board or city council — in minutes.

Acrevia directly covers the challenge requirements:

- address-based property intake,
- public parcel and zoning research,
- preliminary plain-language feasibility,
- likely obstacles,
- mission-aware community materials,
- uncertainty and source citation,
- human expert review,
- preliminary financing,
- 3D massing,
- and council-ready presentation output.

But the product is designed as a real company platform, not a one-off hackathon workflow.

---

# Why this is not another zoning RAG app

Acrevia may use retrieval as one input to regulatory research.

Retrieval is **not the product**.

The core system is:

~~~text
unstructured regulation
        ↓
candidate typed constraints
        ↓
verification + provenance
        ↓
executable rule graph
        ↓
geometry / optimization
        ↓
valid scenarios
        ↓
interactive 3D + decision system
~~~

RAG can tell you what a document says.

Acrevia is designed to answer:

> **Given this land, these verified rules, these mission commitments, and these assumptions — what can actually happen here, and why?**

---

# The 90-second hero demo

The full product can be broad.

The demo must be simple.

### Beat 1 — Opportunity

Open a portfolio.

Select one faith property with underused land.

The property becomes a Development Twin.

### Beat 2 — Constraints become visible

Acrevia resolves the parcel and legal envelope.

Mission requirements are applied:

- preserve sanctuary,
- retain ownership,
- keep Sunday parking.

Valid scenarios rise in 3D.

### Beat 3 — Attack the system

Ask:

> "Give us 70 homes anyway."

Acrevia refuses.

It shows the binding constraints.

Then a conflicting regulation appears.

Acrevia chooses neither convenience nor optimism — it flags the conflict and downgrades the scenario.

### Beat 4 — Proof

Click the verified scenario.

Show:

~~~text
law
→ typed constraint
→ geometry
→ unit count
→ evidence
~~~

### Beat 5 — Move forward

Prepare the board / council package and expert handoff.

End on:

> **Acrevia doesn't hallucinate opportunity.  
> It proves it — or tells you why it can't.**

---

# Product principles

### The canvas is the product

No chatbot-first interface.

The property, geometry, scenarios, evidence, and decisions are primary.

The Copilot is one way to manipulate them.

### Reality beats persuasion

Acrevia should refuse an attractive answer when the evidence does not support it.

### One source of truth

Every downstream artifact should come from the same Development Graph.

### Values are computational

Mission requirements belong in the model, not only in generated copy.

### Preliminary means preliminary

Acrevia accelerates due diligence. It does not impersonate licensed professionals.

### Build for the network, prove it on one property

The architecture should support portfolio-scale use while every individual property remains inspectable.

### Beautiful enough to inspire. Rigorous enough to inspect.

The product should communicate possibility without hiding uncertainty.

---

# Build milestones

- [ ] **Truth Engine** — real property → authoritative sources → structured, cited constraints
- [ ] **Development Graph** — shared project state for land, law, mission, capital, and evidence
- [ ] **Mission Compiler** — church priorities become structured constraints
- [ ] **Scenario Engine** — multiple feasible alternatives and binding-constraint analysis
- [ ] **Forge 3D** — interactive, constraint-derived massing
- [ ] **Proof** — provenance, contradiction handling, abstention, expert escalation
- [ ] **Capital** — preliminary, deterministic ownership / funding scenarios
- [ ] **Council** — stakeholder views and council-ready output
- [ ] **Portfolio** — multi-property opportunity screening
- [ ] **Watch** — project re-evaluation when important conditions change
- [ ] **Acrevia Bench** — hand-built evaluation cases for regulation, evidence, and geometry
- [ ] **Practitioner Validation** — pastors + planners + housing professionals test the workflow

---

# Current status

**Phase:** Product architecture + design specification.

This repository is intentionally starting from the problem, user flow, reliability model, and system architecture before implementation.

The goal is not to build a flashy demo around one happy path.

The goal is to build a coherent system whose hero demo is only one test case of a broader working product.

---

# Built for Gloo AI Hackathon 2026

**Track:** Ministry Resourcing  
**Challenge:** Sacred Spaces, Safe Homes

Acrevia is designed around the challenge's central outcome:

**help a non-expert church leader understand what may be possible on underused property and move toward a credible next step without replacing professional judgment.**

---

## Repository

~~~bash
git clone https://github.com/CosmasMandikonza/Acrevia-.git
cd Acrevia-
~~~

Implementation details and local-development instructions will be added as the codebase lands.

---

<p align="center">
  <strong>Acrevia</strong><br/>
  From land to possibility, with proof.
</p>
