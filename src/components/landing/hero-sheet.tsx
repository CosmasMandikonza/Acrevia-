import styles from "../../app/landing.module.css";

/**
 * Hero study sheet — an original axonometric concept drawing, not a parcel
 * or computed scenario. It stages the product's reading of a property once:
 * SITE (the land that exists) → EVIDENCE (public rules, marked) →
 * POSSIBILITY (study massing inside a dashed planning envelope).
 *
 * Every value drawn here is illustrative by construction: no unit counts,
 * no parking counts, no verified-envelope claim. The disclaimer is part of
 * the sheet, not a footnote. When #7/#8 land, the same three stages are the
 * plug-in points for real pipeline state (see
 * docs/adr/issue-15-integration-notes.md).
 */
export function HeroSheet() {
  return (
    <figure
      className={styles.heroSheet}
      data-testid="hero-sheet"
      aria-labelledby="hero-sheet-title hero-sheet-desc"
    >
      <div className={styles.sheetMast}>
        <span>
          <b>PROPERTY STUDY</b> — CONCEPT
        </span>
        <span>SHEET AV-01 · NTS</span>
      </div>
      <svg viewBox="0 0 780 620" role="img" aria-labelledby="hero-sheet-title hero-sheet-desc">
        <title id="hero-sheet-title">
          Conceptual church property study with evidence markers and possible
          housing massing
        </title>
        <desc id="hero-sheet-desc">
          An illustrative axonometric drawing: a parcel boundary with an
          existing sanctuary and trees, a dashed setback and planning
          envelope, numbered evidence markers, and hatched study volumes for
          possible homes. The drawing explains Acrevia&rsquo;s site, evidence,
          possibility reading. It is not a feasibility result.
        </desc>
        <defs>
          <pattern
            id="landing-grid"
            width="34"
            height="34"
            patternUnits="userSpaceOnUse"
          >
            <path d="M34 0H0V34" fill="none" className={styles.gridLine} />
          </pattern>
          <pattern
            id="landing-hatch"
            width="9"
            height="9"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(30)"
          >
            <path d="M0 0V9" className={styles.hatchLine} />
          </pattern>
        </defs>

        {/* sheet field */}
        <rect x="10" y="10" width="760" height="600" fill="url(#landing-grid)" />
        <rect
          x="10.5"
          y="10.5"
          width="759"
          height="599"
          className={styles.sheetFrame}
          strokeWidth="0.6"
        />

        {/* ------------------------------------------------ plan space */}
        <g transform="translate(385 318) scale(1 .55) rotate(-30)">
          {/* ground */}
          <path d="M-260-190H520V380H-260Z" className={styles.ground} />

          {/* STREET + frontage (site) */}
          <g className={styles.stage1Body}>
            <path d="M-252 158H252" className={styles.streetEdge} />
            <path d="M-252 178H252" className={styles.setback} />
            {[-190, -150, -110, -70, -30, 10].map((x) => (
              <path key={x} d={`M${x} 161v12`} className={styles.parking} />
            ))}
            {[
              [-248, -128],
              [-248, -48],
              [-248, 32],
              [-160, -178],
              [-40, -178],
            ].map(([x, y], i) => (
              <g key={i}>
                <circle cx={x} cy={y} r="21" className={styles.tree} />
                <circle cx={x - 5} cy={y - 5} r="15" className={styles.tree} />
              </g>
            ))}
          </g>

          {/* SANCTUARY — preserved (site) */}
          <g className={styles.stage1Body} transform="translate(-40 95)">
            <path
              d="M-123-117V-187L-42-229 39-187V-117Z"
              className={styles.wallFront}
            />
            <path d="M39-187V-47L-42-5V-145Z" className={styles.wallSide} />
            <path
              d="M-123-187-42-229 39-187-42-145Z"
              className={styles.roofPlane}
            />
            <path d="M-86-101V-65M-66-91V-55M-106-111V-75" className={styles.setback} />
            <path
              d="M-55-184V-263L-36-279-17-263V-184Z"
              className={styles.wallFront}
            />
            <path d="M-36-279V-306M-46-295H-26" className={styles.spire} />
          </g>

          {/* PARCEL BOUNDARY (draws in) */}
          <path
            d="M-240-160H150L240-75V150H-240Z"
            className={`${styles.parcel} ${styles.stage1}`}
            pathLength={1}
          />

          {/* EVIDENCE — setback + planning envelope (dashed, caution) */}
          <g className={styles.stage2}>
            <path
              d="M-216-136H140L216-58V128H-216Z"
              className={styles.setback}
            />
            <path d="M5-150V-290H205V-150M205-290V-15L5 125V-150M5-290V-15H205" className={styles.envelopeEdge} />
            <path d="M5-290H205V-15H5Z" className={styles.envelopeFace} />
          </g>

          {/* POSSIBILITY — study massing inside the envelope */}
          <g className={styles.stage3} data-testid="sheet-massing">
            <path d="M25-135V-235H95V-135M95-235V80L25-20V-135M25-235V80H95" className={styles.massingFace} />
            <path d="M25-235H95V80H25Z" className={styles.massingTop} />
            <path d="M25-135H95V-20H25Z" className={styles.massingFace} />
            <path d="M110-135V-207H185V-135M185-207V-12L110-60V-135M110-207V-12H185" className={styles.massingFace} />
            <path d="M110-207H185V-12H110Z" className={styles.massingTop} />
            <path d="M110-135H185V-60H110Z" className={styles.massingFace} />
            <path d="M25 0V-40H185V0M185-40V75L25 115V0M25-40V75H185" className={styles.massingFace} />
            <path d="M25-40H185V75H25Z" className={styles.massingTop} />
            <path d="M25 0H185V115H25Z" className={styles.massingFace} />
          </g>
        </g>

        {/* ------------------------------------------- sheet furniture */}
        {/* keynotes — 2D overlay */}
        <g className={styles.stage2}>
          <g className={`${styles.stage2Tick} ${styles.k1}`}>
            <path d="M170 402 197 360" className={styles.leader} />
            <circle cx="164" cy="410" r="9" className={styles.keynote} />
            <text x="164" y="413" textAnchor="middle" className={styles.keynoteNum}>
              1
            </text>
          </g>
          <g className={`${styles.stage2Tick} ${styles.k2}`}>
            <path d="M262 268 285 308" className={styles.leader} />
            <circle cx="256" cy="260" r="9" className={styles.keynote} />
            <text x="256" y="263" textAnchor="middle" className={styles.keynoteNum}>
              2
            </text>
          </g>
          <g className={`${styles.stage2Tick} ${styles.k3}`}>
            <path d="M309 462 365 412" className={styles.leader} />
            <circle cx="300" cy="470" r="9" className={styles.keynote} />
            <text x="300" y="473" textAnchor="middle" className={styles.keynoteNum}>
              3
            </text>
          </g>
          <g className={`${styles.stage2Tick} ${styles.k4}`}>
            <path d="M470 108 428 122" className={styles.leader} />
            <circle cx="478" cy="102" r="9" className={styles.keynote} />
            <text x="478" y="105" textAnchor="middle" className={styles.keynoteNum}>
              4
            </text>
          </g>
        </g>

        {/* north + scale */}
        <g className={styles.stage2}>
          <circle cx="726" cy="72" r="15" className={styles.compass} />
          <path d="M726 84V60L720 72H732Z" className={styles.spire} />
          <text x="726" y="52" textAnchor="middle" className={styles.draftLabel}>
            N
          </text>
          <g transform="translate(40 584)">
            <path d="M0 0h80" className={styles.streetEdge} />
            <path d="M0-4v8M20-3v6M40-4v8M60-3v6M80-4v8" className={styles.parking} />
            <text x="0" y="18" className={styles.draftLabel}>
              0
            </text>
            <text x="34" y="18" className={styles.draftLabel}>
              50
            </text>
            <text x="70" y="18" className={styles.draftLabel}>
              100 FT
            </text>
          </g>
        </g>
      </svg>

      <ul className={styles.sheetStages} aria-label="Study stages">
        <li className={styles.stageSite} data-testid="sheet-stage-site">
          SITE
        </li>
        <li aria-hidden="true" className={styles.stageArrow} />
        <li className={styles.stageEvidence} data-testid="sheet-stage-evidence">
          EVIDENCE
        </li>
        <li aria-hidden="true" className={styles.stageArrow} />
        <li className={styles.stagePossibility} data-testid="sheet-stage-possibility">
          POSSIBILITY
        </li>
      </ul>

      <figcaption className={styles.sheetNotes}>
        <ol>
          <li>
            <b>1</b> PARCEL · PUBLIC RECORD
          </li>
          <li>
            <b>2</b> SANCTUARY · PRESERVED
          </li>
          <li>
            <b>3</b> SETBACK · PUBLIC RULE
          </li>
          <li>
            <b>4</b> MASSING · STUDY
          </li>
        </ol>
        <span className={styles.disclaimer}>
          Illustrative study — not a feasibility result
        </span>
      </figcaption>
    </figure>
  );
}
