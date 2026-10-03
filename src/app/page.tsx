import Link from "next/link";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { Brand } from "@/components/brand";
import { AddressForm } from "@/components/address-form";
import { SiteStudy } from "@/components/site-study";
export default function Home() {
  return (
    <div className="landing">
      <header className="landing-header">
        <Brand />
        <nav aria-label="Main navigation">
          <a href="#approach">Our approach</a>
          <Link href="/workspace">
            Open workspace <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </nav>
      </header>
      <main id="main">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="small-rule" />
              FAITH-OWNED LAND. COMMUNITY POSSIBILITY.
            </p>
            <h1>
              Your land could
              <br />
              become <em>homes.</em>
            </h1>
            <p className="hero-description">
              A new chapter for the land you steward.
              <br />
              Explore what could be possible, preserve what matters, and see the
              evidence behind the next step.
            </p>
            <AddressForm />
            <a className="text-link approach-link" href="#approach">
              <ArrowDown size={15} aria-hidden="true" /> From land to
              possibility, with proof.
            </a>
          </div>
          <SiteStudy />
        </section>
        <section id="approach" className="approach">
          <div className="approach-intro">
            <p className="eyebrow">A MORE CONSIDERED FIRST STEP</p>
            <h2>
              Possibility begins
              <br />
              with understanding.
            </h2>
            <p>
              Acrevia is being built to bring land, mission, and evidence into
              one shared view.
            </p>
          </div>
          <ol className="approach-steps">
            <li>
              <span>01</span>
              <div>
                <h3>Understand the land</h3>
                <p>
                  Start with the property and the public rules that shape it.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Protect your mission</h3>
                <p>
                  Make space for the sanctuary, ministries, and commitments you
                  carry forward.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Consider the possibilities</h3>
                <p>
                  Work toward informed alternatives for your board and
                  professional advisors.
                </p>
              </div>
            </li>
          </ol>
        </section>
      </main>
      <footer className="landing-footer">
        <Brand />
        <p>From land to possibility, with proof.</p>
        <span>Foundation preview</span>
      </footer>
    </div>
  );
}
