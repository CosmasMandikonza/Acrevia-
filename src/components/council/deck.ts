import type {
  AudienceView,
  CouncilPackage,
} from "../../application/council/package";
import type { SpatialSceneModel } from "../../spatial/scene-model";
import { buildPlanSvg } from "./plan-svg";

/**
 * One-click council-ready export (issue #13).
 *
 * A deterministic, self-contained HTML document styled as 16:9 slides: the
 * same package the Council room renders, plus the site plan and saved Forge
 * views when the scene is available. Identical inputs produce identical
 * bytes — no timestamps, no randomness — and the file is fully readable
 * without the live app. Printing (or Print → Save as PDF) yields one slide
 * per page in landscape.
 *
 * Citations, assumptions, conflicts, and expert-required items appear in
 * EVERY audience's export (framing changes; the appendix does not).
 */

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CSS = `
  :root { --paper:#f6f5ef; --surface:#fffef9; --ink:#29372d; --line:#ddd9cc;
          --olive:#45583b; --olive-soft:#e7ead9; --amber:#b98a2f; --stone:#6f6a5c; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--paper); color: var(--ink);
         font-family: Arial, Helvetica, sans-serif; }
  .slide { width: 1280px; height: 720px; aspect-ratio: 16 / 9; position: relative;
           padding: 56px 72px; margin: 0 auto 28px auto; background: var(--surface);
           border: 1px solid var(--line); display: flex; flex-direction: column;
           overflow: hidden; page-break-after: always; break-after: page; }
  .eyebrow { font-size: 11px; letter-spacing: 0.16em; font-weight: 700;
             color: var(--stone); text-transform: uppercase; }
  h1 { font-family: "Iowan Old Style", Palatino, Georgia, serif; font-size: 54px;
       line-height: 1.08; margin-top: 18px; }
  h2 { font-family: "Iowan Old Style", Palatino, Georgia, serif; font-size: 34px;
       margin-top: 6px; }
  .sub { color: var(--stone); font-size: 15px; margin-top: 10px; line-height: 1.5; }
  .mono { font-family: ui-monospace, "Cascadia Mono", Menlo, monospace;
          font-size: 11px; color: var(--stone); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 28px; }
  .facts { width: 100%; border-collapse: collapse; margin-top: 24px; }
  .facts td { border-bottom: 1px solid var(--line); padding: 9px 0;
              font-size: 16px; }
  .facts td:last-child { text-align: right; font-weight: 700; }
  .facts td:first-child { color: var(--stone); font-size: 13px;
                          letter-spacing: 0.06em; text-transform: uppercase; }
  .chip { display: inline-block; border: 1px solid var(--line); padding: 3px 10px;
          font-size: 11px; letter-spacing: 0.12em; font-weight: 700; }
  .chip.current { border-color: var(--olive); color: var(--olive); }
  .lead { font-size: 17px; line-height: 1.6; margin-top: 16px; max-width: 62ch; }
  .cta { margin-top: auto; border-left: 4px solid var(--olive);
         background: var(--olive-soft); padding: 14px 18px; font-size: 16px;
         font-weight: 700; }
  .note { border: 1px solid var(--line); padding: 12px 16px; font-size: 12.5px;
          color: var(--stone); line-height: 1.5; margin-top: 24px; }
  .cols { display: grid; grid-template-columns: 1.2fr 1fr; gap: 36px;
          margin-top: 26px; flex: 1; min-height: 0; }
  .plan svg { width: 100%; height: 100%; }
  ul.list { list-style: none; margin-top: 14px; }
  ul.list li { border-bottom: 1px solid var(--line); padding: 8px 0;
               font-size: 14.5px; line-height: 1.45; }
  ul.list li small { display: block; color: var(--stone); font-size: 12px;
                     margin-top: 2px; }
  .foot { position: absolute; bottom: 22px; left: 72px; right: 72px;
          display: flex; justify-content: space-between; }
  table.sources { width: 100%; border-collapse: collapse; margin-top: 18px; }
  table.sources th { text-align: left; font-size: 11px; letter-spacing: 0.1em;
                     color: var(--stone); text-transform: uppercase;
                     border-bottom: 2px solid var(--ink); padding: 6px 10px 6px 0; }
  table.sources td { border-bottom: 1px solid var(--line); padding: 7px 10px 7px 0;
                     font-size: 13px; vertical-align: top; }
  .big { font-size: 44px; font-weight: 700;
         font-family: "Iowan Old Style", Palatino, Georgia, serif; }
  @media print {
    body { background: white; }
    .slide { margin: 0; border: none; page-break-after: always; }
    @page { size: 1280px 720px; margin: 0; }
  }
`;

function slide(inner: string, footLeft: string, footRight: string): string {
  return `<section class="slide">${inner}<div class="foot"><span class="mono">${esc(footLeft)}</span><span class="mono">${esc(footRight)}</span></div></section>`;
}

export function councilDeckFilename(
  pkg: CouncilPackage,
  audience: AudienceView["audience"],
): string {
  const project = pkg.project.projectId.replace(/[^a-z0-9-]/gi, "");
  return `acrevia-council-${project}-${audience}.html`;
}

export function buildCouncilDeckHtml(
  pkg: CouncilPackage,
  scene: SpatialSceneModel | null,
  audience: AudienceView["audience"],
): string {
  const view = pkg.audienceViews[audience];
  const f = pkg.facts;
  const fact = (key: string) => f[key]?.value ?? "—";
  const foot = `${pkg.project.projectId} · ${pkg.selected.scenarioLabel} · CERTIFICATE CURRENT · FINGERPRINT ${pkg.packageFingerprint.slice(0, 16)}`;
  const audienceFoot = `ACREVIA COUNCIL PACKAGE · ${view.label}`;
  const slides: string[] = [];

  // 1 — Title -----------------------------------------------------------------
  slides.push(
    slide(
      `<span class="eyebrow">Acrevia · Council decision package</span>
       <h1>${esc(fact("address"))}</h1>
       <p class="sub">${esc(pkg.selected.scenarioLabel)} scenario · ${esc(fact("homes"))} homes · ${esc(fact("parking"))} · ${esc(fact("floors"))} — assembled from the current verified project state.</p>
       <div style="margin-top:22px">
         <span class="chip current">CERTIFICATE ${esc(pkg.certificate.freshness)}</span>
         <span class="chip">PREPARED FOR ${esc(view.label)}</span>
         <span class="chip">CONCEPTUAL — NOT A PERMIT APPLICATION</span>
       </div>
       <p class="note">${esc(pkg.boundaryNotice)}</p>
       <p class="mono" style="margin-top:18px">PACKAGE ${esc(pkg.packageVersion)} · FINGERPRINT ${esc(pkg.packageFingerprint.slice(0, 32))} · ${esc(pkg.certificate.id)}</p>`,
      audienceFoot,
      foot,
    ),
  );

  // 2 — The decision, framed for this audience --------------------------------
  slides.push(
    slide(
      `<span class="eyebrow">${esc(view.label)} — ${esc(view.essence)}</span>
       <h2>${esc(view.headline)}</h2>
       ${view.lead.map((line) => `<p class="lead">${esc(line)}</p>`).join("")}
       <div class="cta">${esc(view.cta)}</div>`,
      audienceFoot,
      foot,
    ),
  );

  // 3 — The emphasis facts (same table for every audience) --------------------
  slides.push(
    slide(
      `<span class="eyebrow">The same facts, emphasized for ${esc(view.label)}</span>
       <h2>What this audience should look at first</h2>
       <table class="facts">${view.emphasis
         .map(
           (item) =>
             `<tr><td>${esc(f[item.factKey]?.label ?? item.factKey)}</td><td>${esc(fact(item.factKey))}</td></tr>
              <tr><td colspan="2" style="border:none;color:var(--stone);font-size:12px;text-transform:none;letter-spacing:0;padding:0 0 10px 0">${esc(item.why)}</td></tr>`,
         )
         .join("")}</table>`,
      audienceFoot,
      foot,
    ),
  );

  // 4 — The site (plan + saved views) ------------------------------------------
  const plan = scene ? buildPlanSvg(scene, pkg.selected.scenarioId) : null;
  slides.push(
    slide(
      `<span class="eyebrow">Conceptual spatial basis — derived from the same constraints</span>
       <h2>The site, as the model knows it</h2>
       <div class="cols"><div class="plan">${
         plan ??
         `<p class="sub">The spatial scene is not available for this state; every number in this package stands on its own — the site plan does not.</p>`
       }</div>
       <div>${
         scene
           ? `<span class="eyebrow">Saved Forge views</span><ul class="list">${scene.cameras
               .map(
                 (camera) =>
                   `<li>${esc(camera.label)}<small>${esc(camera.note)}</small></li>`,
               )
               .join("")}</ul>`
           : ""
       }</div></div>
       <p class="note">Conceptual massing derived from law ∩ mission constraints over recorded parcel geometry. It is preliminary planning geometry — not architectural design, and not an approval.</p>`,
      audienceFoot,
      foot,
    ),
  );

  // 5 — The scenario ------------------------------------------------------------
  slides.push(
    slide(
      `<span class="eyebrow">Selected scenario — deterministic, certified</span>
       <h2>${esc(pkg.selected.scenarioLabel)}</h2>
       <div class="grid">
         <div><table class="facts">
           <tr><td>Homes</td><td>${esc(fact("homes"))}</td></tr>
           <tr><td>Sunday parking</td><td>${esc(fact("parking"))}</td></tr>
           <tr><td>Scale</td><td>${esc(fact("floors"))}</td></tr>
           <tr><td>Height ceiling</td><td>${esc(fact("height-limit"))}</td></tr>
           <tr><td>Footprint</td><td>${esc(fact("footprint"))}</td></tr>
           <tr><td>Confidence</td><td>${esc(fact("confidence"))}</td></tr>
         </table></div>
         <div>
           <p class="sub" style="margin-top:0"><strong>${pkg.selected.satisfiedCount} of ${pkg.selected.constraintResults.length}</strong> evaluated constraint checks satisfied.</p>
           <ul class="list">${pkg.selected.constraintResults
             .filter((result) => result.status !== "SATISFIED")
             .slice(0, 5)
             .map(
               (result) =>
                 `<li>${esc(result.constraint)} — <strong>${esc(result.status)}</strong>${result.limit ? ` (limit ${esc(result.limit)})` : ""}<small>${esc(result.explanation)}</small></li>`,
             )
             .join("")}</ul>
         </div>
       </div>
       <p class="mono" style="margin-top:16px">${esc(pkg.selected.scenarioId)} · ${esc(pkg.certificate.id)} · SOLVER ${esc(pkg.selected.solverVersion)} · ${pkg.certificate.dependencyCount} PINNED DEPENDENCIES</p>`,
      audienceFoot,
      foot,
    ),
  );

  // 6 — Mission + capital ---------------------------------------------------------
  slides.push(
    slide(
      `<span class="eyebrow">Mission commitments and preliminary capital</span>
       <h2>What the congregation kept — and what delivery preliminarily takes</h2>
       <div class="grid"><div>
         <ul class="list">${
           pkg.mission.commitments.length === 0
             ? `<li>No mission commitments confirmed — scenarios are computed without congregational priorities.</li>`
             : pkg.mission.commitments
                 .map(
                   (commitment) =>
                     `<li>${esc(commitment.normalizedSummary)} (${esc(commitment.hardOrSoft)})<small>“${esc(commitment.intentText)}”</small></li>`,
                 )
                 .join("")
         }</ul></div><div>
         ${
           pkg.capital
             ? `<table class="facts">
                  <tr><td>Pathway</td><td>${esc(pkg.capital.pathway.label)}</td></tr>
                  <tr><td>Total development cost</td><td>${esc(pkg.capital.totalDevelopmentCost)}</td></tr>
                  <tr><td>Identified capital</td><td>${esc(pkg.capital.identifiedCapital)}</td></tr>
                  <tr><td>Funding gap</td><td>${esc(pkg.capital.fundingGap)} (${esc(pkg.capital.gapPctOfCost)}%)</td></tr>
                  <tr><td>Affordable homes</td><td>${esc(fact("affordable-homes"))}</td></tr>
                </table>
                <p class="sub">${pkg.capital.projection.map((line) => esc(line)).join(" ")}</p>`
             : `<p class="sub">Capital has not been evaluated for this scenario. No cost, funding, or affordability figures should be quoted from this package.</p>`
         }
       </div></div>`,
      audienceFoot,
      foot,
    ),
  );

  // 7 — Assumptions / conflicts / expert-required -----------------------------------
  slides.push(
    slide(
      `<span class="eyebrow">What stands behind the numbers — and what does not</span>
       <h2>Assumptions, conflicts, expert-required</h2>
       <div class="grid"><div>
         <span class="eyebrow">Active assumptions (${pkg.evidence.assumptions.length})</span>
         <ul class="list">${pkg.evidence.assumptions
           .map(
             (assumption) =>
               `<li>${esc(assumption.statement)} — ${esc(assumption.valueSummary)}<small>${esc(assumption.rationale)}</small></li>`,
           )
           .join("")}</ul>
       </div><div>
         <span class="eyebrow">Conflicts (${pkg.evidence.conflicts.length})</span>
         <ul class="list">${
           pkg.evidence.conflicts.length === 0
             ? `<li>No unresolved conflicts among the captured sources.</li>`
             : pkg.evidence.conflicts
                 .map(
                   (conflict) =>
                     `<li>${esc(conflict.semanticRuleKey)} — ${esc(conflict.resolution)}<small>${esc(conflict.explanation)}</small></li>`,
                 )
                 .join("")
         }</ul>
         <span class="eyebrow" style="display:block;margin-top:18px">Expert review required (${pkg.evidence.expertReviews.length})</span>
         <ul class="list">${pkg.evidence.expertReviews
           .map(
             (review) =>
               `<li>[${esc(review.severity)}] ${esc(review.question)}<small>${esc(review.category)} · ${esc(review.reviewStatus)}</small></li>`,
           )
           .join("")}</ul>
       </div></div>`,
      audienceFoot,
      foot,
    ),
  );

  // 8 — Next decision ------------------------------------------------------------------
  slides.push(
    slide(
      `<span class="eyebrow">The decision actually being requested</span>
       <p class="big" style="margin-top:24px;max-width:26ch">${esc(pkg.nextDecision.headline)}</p>
       <p class="lead">${esc(pkg.nextDecision.rationale)}</p>
       ${
         pkg.nextDecision.blockers.length > 0
           ? `<ul class="list" style="margin-top:18px">${pkg.nextDecision.blockers
               .map((blocker) => `<li>${esc(blocker)}</li>`)
               .join("")}</ul>`
           : ""
       }
       <div class="cta">${esc(view.cta)}</div>`,
      audienceFoot,
      foot,
    ),
  );

  // 9 — Sources & verification ------------------------------------------------------------
  slides.push(
    slide(
      `<span class="eyebrow">Sources and verification</span>
       <h2>Every citation behind this package</h2>
       <table class="sources">
         <tr><th>Source</th><th>Publisher</th><th>Authority</th><th>Retrieved</th></tr>
         ${pkg.evidence.sources
           .map(
             (source) =>
               `<tr><td>${esc(source.title)}</td><td>${esc(source.publisher)}</td><td>${esc(source.authority)}</td><td>${esc(source.retrievedAt.slice(0, 10))}</td></tr>`,
           )
           .join("")}
       </table>
       <p class="mono" style="margin-top:20px">CERTIFICATE ${esc(pkg.certificate.id)} · HASH ${esc(pkg.certificate.certificateHash.slice(0, 32))} · PACKAGE ${esc(pkg.packageFingerprint.slice(0, 32))} · ${esc(pkg.boundaryNotice)}</p>`,
      audienceFoot,
      foot,
    ),
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acrevia Council Package — ${esc(fact("address"))} — ${esc(view.label)}</title>
<style>${CSS}</style>
</head>
<body>
${slides.join("\n")}
</body>
</html>`;
}
