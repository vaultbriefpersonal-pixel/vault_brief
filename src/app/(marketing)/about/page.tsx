import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About — VaultBrief",
  description:
    "We built VaultBrief because we watched too many good crypto projects lose investor confidence over bad reporting.",
};

const TEAM = [
  {
    name: "Alex Kim",
    role: "CEO and Co-founder",
    bio: "Previously led treasury ops at a top-10 DeFi protocol. Spent 3 years manually building investor reports in Google Sheets.",
    avatar: "AK",
  },
  {
    name: "Jordan Lee",
    role: "CTO and Co-founder",
    bio: "Former infrastructure engineer at Coinbase. Built data pipelines for on-chain analytics at scale.",
    avatar: "JL",
  },
  {
    name: "Maya Okonkwo",
    role: "Head of Product",
    bio: "Designed reporting tools at two fintech startups. Obsessed with reducing time-to-insight for finance teams.",
    avatar: "MO",
  },
];

const VALUES = [
  {
    title: "Transparency first",
    desc: "We believe crypto projects that communicate clearly with their investors build longer-lasting trust and better cap tables.",
  },
  {
    title: "Data you can trust",
    desc: "Every number in your report comes directly from on-chain data. No estimates, no manual entry, no room for error.",
  },
  {
    title: "Built for founders",
    desc: "You should spend your time building, not formatting spreadsheets. We handle the reporting so you do not have to.",
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
          About VaultBrief
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
          We got tired of bad investor reports
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
          We built VaultBrief because we watched too many good crypto projects
          lose investor confidence over reporting that was late, vague, or
          inconsistent. The data was always there on-chain. The problem was the
          hours it took to pull it together.
        </p>
      </section>

      {/* Story */}
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
            Why we built this
          </h2>
          <p style={{ margin: "0 0 20px" }}>
            In 2024, our co-founder Alex was running treasury operations for a
            DeFi protocol. Every month, the same routine: pull wallet balances
            from Etherscan, open another tab for Arbiscan, download CSVs,
            reconcile transactions in a spreadsheet, write a narrative in
            Notion, send a vague email to investors — two weeks after the
            month closed.
          </p>
          <p style={{ margin: "0 0 20px" }}>
            Investors were asking for numbers that already existed on-chain. The
            friction was entirely in the tooling. So we built VaultBrief.
          </p>
          <p style={{ margin: 0 }}>
            Today, VaultBrief automatically generates professional investor
            reports from on-chain data, classifies expenses with AI, and
            delivers branded PDFs to your investor list on the 1st of every
            month. No spreadsheets. No formatting. Just reporting that gets
            done.
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
          <div
            className="vb-grid-3"
            style={{ gap: 24 }}
          >
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

      {/* Team */}
      <section className="vb-section-sm" style={{ background: "var(--vb-alt)" }}>
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
            The team
          </h2>
          <div
            className="vb-grid-3"
            style={{ gap: 24 }}
          >
            {TEAM.map((person) => (
              <div
                key={person.name}
                className="card-hover"
                style={{
                  background: "var(--vb-card)",
                  borderRadius: 14,
                  border: "1px solid var(--vb-border)",
                  padding: 32,
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    background: "rgba(0,232,123,0.12)",
                    border: "1px solid rgba(0,232,123,0.2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily:
                      "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    fontSize: 16,
                    fontWeight: 700,
                    color: "var(--accent)",
                    marginBottom: 20,
                  }}
                >
                  {person.avatar}
                </div>
                <h3
                  style={{
                    fontFamily:
                      "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    fontSize: 18,
                    fontWeight: 600,
                    color: "var(--vb-text)",
                    margin: "0 0 4px",
                  }}
                >
                  {person.name}
                </h3>
                <p
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 13,
                    color: "var(--accent)",
                    margin: "0 0 14px",
                    fontWeight: 500,
                  }}
                >
                  {person.role}
                </p>
                <p
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 14,
                    color: "var(--vb-muted)",
                    lineHeight: 1.6,
                    margin: 0,
                  }}
                >
                  {person.bio}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        className="vb-section-sm"
        style={{ textAlign: "center" }}
      >
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
          Want to work with us?
        </h2>
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 16,
            color: "var(--vb-muted)",
            margin: "0 0 28px",
          }}
        >
          We are a small team building something ambitious.
        </p>
        <Link
          href="mailto:hello@vaultbrief.com"
          className="btn-primary"
        >
          Get in touch
        </Link>
      </section>
    </div>
  );
}
