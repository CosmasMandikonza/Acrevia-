import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Brand } from "@/components/brand";
import { AddressEntry } from "@/components/landing/address-entry";
import { HeroSheet } from "@/components/landing/hero-sheet";
import { TransformationSequence } from "@/components/landing/transformation-sequence";
import { ProofStatement } from "@/components/landing/proof-statement";
import styles from "./landing.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.masthead}>
        <Brand />
        <nav aria-label="Main navigation">
          <a className={styles.howLink} href="#how">
            How Acrevia reads a property
          </a>
          <Link className={styles.workspaceLink} href="/workspace">
            Open workspace <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </nav>
      </header>
      <main id="main">
        <section
          className={styles.hero}
          aria-label="Your land could become homes"
        >
          <div className={styles.heroCopy}>
            <p className={styles.kicker}>
              01 · FAITH-OWNED LAND, COMMUNITY POSSIBILITY
            </p>
            <h1 className={styles.headline}>
              Your land could{" "}
              <br />
              become <em>homes.</em>
            </h1>
            <p className={styles.subheadline}>
              Know what&rsquo;s possible before the first expensive meeting.
            </p>
            <AddressEntry scope="hero" />
          </div>
          <HeroSheet />
        </section>
        <TransformationSequence />
        <ProofStatement />
        <section className={styles.section} aria-labelledby="begin-heading">
          <div className={styles.transition}>
            <div>
              <p className={styles.sectionIndex}>04 · BEGIN</p>
              <h2 id="begin-heading">Begin with the property you know.</h2>
              <p>
                Enter any church address. Acrevia opens the workspace, reads
                the public record, and asks what your mission must protect
                — before anyone promises what could be built.
              </p>
              <Link className={styles.directLink} href="/workspace">
                Or open the workspace directly
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            </div>
            <AddressEntry scope="entry" />
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <Brand />
        <p className={styles.thesis}>From land to possibility, with proof.</p>
        <span>Foundation preview</span>
      </footer>
    </div>
  );
}
