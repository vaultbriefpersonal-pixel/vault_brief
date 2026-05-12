import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About — Vault Brief",
  description:
    "Why this exists. The single-paragraph story behind Vault Brief — from the friction every Web3 founder hits each month to the tool that makes it disappear.",
};

const VALUES = [
  {
    title: "Transparency first",
    desc: "Crypto projects that communicate clearly with their investors build longer-lasting trust and better cap tables.",
  },
  {
    title: "Data you can trust",
    desc: "Every number in your report comes directly from on-chain data. No estimates, no manual entry, no fabrication — the LLM is sandboxed against the source snapshot.",
  },
  {
    title: "Built for founders",
    desc: "You should spend your time building, not formatting spreadsheets. Vault Brief handles reporting so you don't have to.",
  },
];

export default function AboutPage() {
  return (
    <div style={{ paddingTop: 72 }}>
      {/* Mission */}
      <section
        className="vb-pad-x"
        style={{
          paddingTop: 100,
          paddingBottom: 80,
          maxWidth: 800,
          margin: "0 auto",
          textAlign: "center",
          background:
            "linear-gradient(180deg, rgba(0,232,123,0.04) 0%, transparent 100%)",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            color: "var(--accent)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            fontWeight: 600,
            marginBottom: 16,
          }}
        >
          About Vault Brief
        </p>
        <h1
          style={{
            fontFamily:
              "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
            fontSize: "clamp(36px, 5vw, 56px)",
            fontWeight: 700,
            color: "var(--vb-text)",
            letterSpacing: "-0.035em",
            margin: "0 0 24px",
            lineHeight: 1.1,
          }}
        >
          Why this exists
        </h1>
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 18,
            color: "var(--vb-muted)",
            lineHeight: 1.7,
            margin: 0,
          }}
        >
          Every Web3 founder spends about eight hours a month copy-pasting
          Etherscan into Google Docs. The data is already public on-chain.
          The friction is entirely in the tooling. Vault Brief removes that
          friction — it pulls treasury balances, classifies transactions,
          summarises GitHub activity, and asks an LLM to write a structured
          monthly narrative. Investors get a polished PDF; founders get
          their afternoon back.
        </p>
      </section>

      {/* Story — single paragraph, honest */}
      <section
        className="vb-section-sm"
        style={{ background: "var(--vb-alt)" }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 16,
            color: "var(--vb-muted)",
            lineHeight: 1.8,
          }}
        >
          <h2
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: "clamp(28px, 3vw, 36px)",
              fontWeight: 700,
              color: "var(--vb-text)",
              letterSpacing: "-0.03em",
              margin: "0 0 24px",
            }}
          >
            How we got here
          </h2>
          <p style={{ margin: "0 0 20px" }}>
            The first version pulled balances from Alchemy, Dune, and Helius
            and dumped them into a Markdown template. The second version
            added the LLM narrative. The third taught the model to never
            fabricate a balance — the validator now checks every dollar
            figure in the prose against the source snapshot. Every release
            after that has been about making the output something a fund
            manager would actually forward to their LPs.
          </p>
          <p style={{ margin: 0 }}>
            Vault Brief is a production SaaS product. The tool is live, the
            data is real, and reports are generated every cycle. Production
            usage numbers update on the homepage in real time.
          </p>
        </div>
      </section>

      {/* Values */}
      <section className="vb-section-sm">
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <h2
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: "clamp(28px, 3vw, 36px)",
              fontWeight: 700,
              color: "var(--vb-text)",
              letterSpacing: "-0.03em",
              margin: "0 0 48px",
              textAlign: "center",
            }}
          >
            What we believe
          </h2>
          <div className="vb-grid-3" style={{ gap: 24 }}>
            {VALUES.map((v) => (
              <div
                key={v.title}
                className="card-hover"
                style={{
                  background: "var(--vb-card)",
                  borderRadius: 14,
                  border: "1px solid var(--vb-border)",
                  padding: 32,
                }}
              >
                <h3
                  style={{
                    fontFamily:
                      "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    fontSize: 19,
                    fontWeight: 600,
                    color: "var(--vb-text)",
                    margin: "0 0 12px",
                  }}
                >
                  {v.title}
                </h3>
                <p
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 15,
                    color: "var(--vb-muted)",
                    lineHeight: 1.65,
                    margin: 0,
                  }}
                >
                  {v.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="vb-section-sm" style={{ textAlign: "center" }}>
        <h2
          style={{
            fontFamily:
              "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
            fontSize: "clamp(28px, 3vw, 36px)",
            fontWeight: 700,
            color: "var(--vb-text)",
            letterSpacing: "-0.03em",
            margin: "0 0 16px",
          }}
        >
          Got a treasury you want to see narrated?
        </h2>
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 16,
            color: "var(--vb-muted)",
            margin: "0 0 28px",
          }}
        >
          Try it on a public DAO treasury — or your own. First report on us.
        </p>
        <Link href="/login" className="btn-primary">
          Generate a report
        </Link>
      </section>
    </div>
  );
}
