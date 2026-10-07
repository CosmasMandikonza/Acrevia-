import styles from "../../app/landing.module.css";

/**
 * Section 02 — one parcel, four readings. The same plan polygon gains one
 * layer per question: LAND (what exists), TRUTH (public rules), MISSION
 * (what must remain), POSSIBILITY (study massing). Divided by rules, not
 * cards; identical geometry keeps the transformation legible.
 */

const PARCEL = "M18 34H146L202 62V138H18Z";
const SANCTUARY = "M34 48H64V82H34Z";
const STEEPLE = "M40 36H58V48H40Z";

function Base({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <path d="M8 152H212" className={styles.planStreet} />
      <path d={PARCEL} className={styles.planGround} />
      <path d={PARCEL} className={styles.planParcel} />
      <path d={SANCTUARY} className={styles.planBuilding} />
      <path d={STEEPLE} className={styles.planBuilding} />
      <circle cx="182" cy="122" r="8" className={styles.planTree} />
      <circle cx="30" cy="118" r="8" className={styles.planTree} />
      {children}
    </>
  );
}

function Mark({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <>
      <circle cx={x} cy={y} r="5.5" className={styles.planMark} />
      <text
        x={x}
        y={y + 2.5}
        textAnchor="middle"
        className={styles.planMarkNum}
      >
        {n}
      </text>
    </>
  );
}

export function TransformationSequence() {
  return (
    <section
      id="how"
      className={styles.section}
      aria-labelledby="how-heading"
    >
      {/* shared defs sprite — one hatch pattern for all four state drawings */}
      <svg
        aria-hidden="true"
        width="0"
        height="0"
        style={{ position: "absolute" }}
      >
        <defs>
          <pattern
            id="landing-hatch-thin"
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(30)"
          >
            <path d="M0 0V5" className={styles.hatchThin} />
          </pattern>
        </defs>
      </svg>
      <div className={styles.sectionHead}>
        <span className={styles.sectionIndex}>02</span>
        <h2 id="how-heading">The same land, read four ways.</h2>
        <p>
          Acrevia holds one property and four questions — every answer tied
          to a public source or marked as an assumption.
        </p>
      </div>
      <div className={styles.sequence}>
        <figure data-testid="sequence-land">
          <svg viewBox="0 0 220 170" role="img" aria-label="Land — the existing parcel and sanctuary">
            <Base />
          </svg>
          <figcaption>
            <b>01 · LAND</b>
            <span>The property you already own.</span>
          </figcaption>
        </figure>
        <figure data-testid="sequence-truth">
          <svg viewBox="0 0 220 170" role="img" aria-label="Truth — public rules found and cited">
            <Base>
              <path d="M96 34H146L202 62V86H96Z" className={styles.planRuleZone} />
              <path d="M32 46H138L188 68V126H32Z" className={styles.planSetback} />
              <Mark x={146} y={30} n={1} />
              <Mark x={188} y={97} n={2} />
              <Mark x={49} y={65} n={3} />
            </Base>
          </svg>
          <figcaption>
            <b>02 · TRUTH</b>
            <span>Public rules, found and cited.</span>
          </figcaption>
        </figure>
        <figure data-testid="sequence-mission">
          <svg viewBox="0 0 220 170" role="img" aria-label="Mission — the sanctuary and yard protected">
            <Base>
              <path d="M24 32H74V98H24Z" className={styles.planProtected} />
              <path d={SANCTUARY} className={styles.planBuilding} />
              <path d={STEEPLE} className={styles.planBuilding} />
              <text x="24" y="114" className={styles.planTag}>
                PROTECTED
              </text>
            </Base>
          </svg>
          <figcaption>
            <b>03 · MISSION</b>
            <span>What must remain, protected.</span>
          </figcaption>
        </figure>
        <figure data-testid="sequence-possibility">
          <svg viewBox="0 0 220 170" role="img" aria-label="Possibility — study massing within a planning envelope">
            <Base>
              <path d="M96 40H146L192 64V128H96Z" className={styles.planEnvelope} />
              <path d="M104 48H134V88H104Z" className={styles.planMassing} />
              <path d="M142 62H168V96H142Z" className={styles.planMassing} />
              <text x="96" y="166" className={styles.planTag}>
                STUDY
              </text>
            </Base>
          </svg>
          <figcaption>
            <b>04 · POSSIBILITY</b>
            <span>What could fit, computed.</span>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
