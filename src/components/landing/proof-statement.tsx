import styles from "../../app/landing.module.css";

/**
 * Section 03 — the proof statement. One claim, set in editorial type, with
 * the trust vocabulary the product actually assigns to constraints. The
 * vocabulary is the real evidence discipline (SOURCE CONFIRMED /
 * MACHINE CHECKED / ASSUMPTION / EXPERT REQUIRED), shown here as the
 * standard every Acrevia output is held to.
 */
export function ProofStatement() {
  return (
    <section className={styles.proof} aria-label="Proof">
      <p className={styles.proofIndex}>03 · PROOF</p>
      <blockquote>
        <p>
          Acrevia doesn&rsquo;t generate an image of what might happen here.{" "}
          <em>It calculates what can happen here.</em>
        </p>
      </blockquote>
      <div className={styles.proofKey} aria-label="Trust vocabulary">
        <span className={styles.confirmed}>SOURCE CONFIRMED</span>
        <span>MACHINE CHECKED</span>
        <span className={styles.cautioned}>ASSUMPTION</span>
        <span className={styles.escalated}>EXPERT REQUIRED</span>
      </div>
    </section>
  );
}
