import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Docs — VaultBrief",
  description:
    "API reference, integration guides, and SDK examples for VaultBrief.",
};

const SIDEBAR = [
  {
    section: "Getting Started",
    items: [
      { label: "Introduction", href: "#introduction" },
      { label: "Quick Start", href: "#quickstart" },
      { label: "Authentication", href: "#auth" },
    ],
  },
  {
    section: "Integrations",
    items: [
      { label: "Connect Wallets", href: "#wallets" },
      { label: "GitHub Setup", href: "#github" },
      { label: "Alchemy", href: "#alchemy" },
      { label: "Dune Analytics", href: "#dune" },
    ],
  },
  {
    section: "API Reference",
    items: [
      { label: "Projects", href: "#api-projects" },
      { label: "Reports", href: "#api-reports" },
      { label: "Wallets", href: "#api-wallets" },
      { label: "Investors", href: "#api-investors" },
      { label: "Webhooks", href: "#api-webhooks" },
    ],
  },
  {
    section: "SDK",
    items: [
      { label: "JavaScript / TypeScript", href: "#sdk-js" },
      { label: "Python", href: "#sdk-python" },
      { label: "Examples", href: "#sdk-examples" },
    ],
  },
];

const h1Style: React.CSSProperties = {
  fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
  fontSize: 40,
  fontWeight: 700,
  color: "#f0f0f0",
  letterSpacing: "-0.03em",
  margin: "12px 0 16px",
};

const h2Style: React.CSSProperties = {
  fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
  fontSize: 24,
  fontWeight: 600,
  color: "#f0f0f0",
  letterSpacing: "-0.02em",
  margin: "48px 0 14px",
};

const h3Style: React.CSSProperties = {
  fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
  fontSize: 18,
  fontWeight: 600,
  color: "#f0f0f0",
  margin: "28px 0 10px",
};

const pStyle: React.CSSProperties = {
  fontFamily: "var(--font-inter), Inter, sans-serif",
  fontSize: 15,
  color: "#888888",
  lineHeight: 1.75,
  margin: "0 0 16px",
  maxWidth: 680,
};

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-inter), Inter, sans-serif",
  fontSize: 11,
  fontWeight: 600,
  color: "#00e87b",
  textTransform: "uppercase",
  letterSpacing: "0.09em",
};

const dividerStyle: React.CSSProperties = {
  borderTop: "1px solid rgba(255,255,255,0.08)",
  margin: "64px 0 0",
  paddingTop: 64,
};

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <div
      style={{
        background: "#0d0d0d",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        overflow: "hidden",
        margin: "16px 0 24px",
      }}
    >
      <div
        style={{
          padding: "10px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 12,
            color: "#555555",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontWeight: 600,
          }}
        >
          {lang}
        </span>
      </div>
      <pre
        style={{
          padding: 24,
          margin: 0,
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 13,
          color: "#a0a0a0",
          lineHeight: 1.65,
          overflowX: "auto",
          whiteSpace: "pre",
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

function EndpointBadge({ method, path }: { method: string; path: string }) {
  const colors: Record<string, string> = {
    GET: "#4f9cf9",
    POST: "#00e87b",
    DELETE: "#f87171",
    PATCH: "#fb923c",
  };
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        background: "#161616",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 8,
        padding: "10px 16px",
        margin: "10px 0 20px",
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 13.5,
      }}
    >
      <span style={{ color: colors[method] ?? "#888888", fontWeight: 700 }}>{method}</span>
      <span style={{ color: "#f0f0f0" }}>{path}</span>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div style={{ paddingTop: 72, minHeight: "100vh" }}>
      <div
        className="vb-stack-mobile vb-pad-x"
        style={{
          display: "grid",
          gridTemplateColumns: "260px 1fr",
          maxWidth: 1200,
          margin: "0 auto",
        }}
      >
        {/* Sidebar */}
        <aside
          style={{
            padding: "48px 0",
            borderRight: "1px solid rgba(255,255,255,0.08)",
            position: "sticky",
            top: 72,
            height: "calc(100vh - 72px)",
            overflowY: "auto",
          }}
        >
          {SIDEBAR.map((group) => (
            <div key={group.section} style={{ marginBottom: 32 }}>
              <p
                style={{
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#555555",
                  textTransform: "uppercase",
                  letterSpacing: "0.09em",
                  margin: "0 0 10px",
                  paddingRight: 24,
                }}
              >
                {group.section}
              </p>
              {group.items.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  style={{
                    display: "block",
                    padding: "7px 16px 7px 0",
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 14,
                    color: "#888888",
                    textDecoration: "none",
                    borderRight: "2px solid transparent",
                    marginRight: -1,
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </aside>

        {/* Content */}
        <main style={{ padding: "48px 0 120px" }}>

          {/* Introduction */}
          <div id="introduction">
            <span style={labelStyle}>Getting Started</span>
            <h1 style={h1Style}>Introduction</h1>
            <p style={pStyle}>
              VaultBrief provides a REST API and webhooks for automating investor
              reporting workflows. Use the API to trigger report generation,
              fetch treasury snapshots, manage investor lists, and integrate with
              your existing tooling.
            </p>

            <div
              className="vb-grid-2"
              style={{ gap: 16, marginBottom: 48 }}
            >
              {[
                { icon: "⚡", title: "Quick Start", desc: "Connect your first wallet and generate a report in 5 minutes.", href: "#quickstart" },
                { icon: "🔑", title: "Authentication", desc: "API keys, rate limits, and request signing.", href: "#auth" },
                { icon: "🔗", title: "Wallet Integration", desc: "Connect EVM and Solana wallets via public address.", href: "#wallets" },
                { icon: "📡", title: "Webhooks", desc: "Get notified when reports are generated or sent.", href: "#api-webhooks" },
              ].map((card) => (
                <Link
                  key={card.title}
                  href={card.href}
                  style={{
                    display: "block",
                    background: "#161616",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 12,
                    padding: 24,
                    textDecoration: "none",
                  }}
                >
                  <span style={{ fontSize: 24, display: "block", marginBottom: 12 }}>{card.icon}</span>
                  <h3 style={{ fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif", fontSize: 16, fontWeight: 600, color: "#f0f0f0", margin: "0 0 6px" }}>
                    {card.title}
                  </h3>
                  <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 13.5, color: "#888888", margin: 0, lineHeight: 1.5 }}>
                    {card.desc}
                  </p>
                </Link>
              ))}
            </div>

            <h2 style={h2Style}>Base URL</h2>
            <div
              style={{
                background: "#161616",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10,
                padding: "14px 20px",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 14,
                color: "#00e87b",
                marginBottom: 16,
              }}
            >
              https://api.vaultbrief.com/v1
            </div>
            <p style={pStyle}>All API requests must be made over HTTPS. HTTP requests will be rejected.</p>
          </div>

          {/* Quick Start */}
          <div id="quickstart" style={dividerStyle}>
            <span style={labelStyle}>Getting Started</span>
            <h1 style={h1Style}>Quick Start</h1>
            <p style={pStyle}>
              Get your first automated investor report in under 5 minutes. You only need a VaultBrief account and at least one wallet address.
            </p>

            {[
              {
                step: "1",
                title: "Create an account",
                desc: "Sign up at vaultbrief.com. No credit card required for the 14-day trial.",
              },
              {
                step: "2",
                title: "Create a project",
                desc: "A project represents your DAO, protocol, or startup. Give it a name, token symbol (e.g. PROJ), and optionally a GitHub organization.",
              },
              {
                step: "3",
                title: "Connect a wallet",
                desc: "Add one or more wallet addresses. VaultBrief reads balances and transaction history using public RPC — no private keys needed.",
              },
              {
                step: "4",
                title: "Generate a report",
                desc: "Go to Reports and click Generate. VaultBrief pulls on-chain data, runs the AI narrative, and produces a PDF-ready report in under 30 seconds.",
              },
            ].map((item) => (
              <div
                key={item.step}
                style={{
                  display: "flex",
                  gap: 20,
                  marginBottom: 28,
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: "rgba(0,232,123,0.12)",
                    border: "1px solid rgba(0,232,123,0.3)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#00e87b",
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  {item.step}
                </div>
                <div>
                  <h3 style={{ ...h3Style, margin: "0 0 6px" }}>{item.title}</h3>
                  <p style={{ ...pStyle, margin: 0 }}>{item.desc}</p>
                </div>
              </div>
            ))}

            <h2 style={h2Style}>Your first API call</h2>
            <p style={pStyle}>Once your project is set up, trigger report generation via the API:</p>
            <CodeBlock
              lang="bash"
              code={`curl -X POST https://api.vaultbrief.com/v1/reports/generate \\
  -H "Authorization: Bearer vb_live_your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{"project_id": "proj_abc123", "period": "2026-04"}'`}
            />
          </div>

          {/* Authentication */}
          <div id="auth" style={dividerStyle}>
            <span style={labelStyle}>Getting Started</span>
            <h1 style={h1Style}>Authentication</h1>
            <p style={pStyle}>
              All API requests require an API key passed in the Authorization header. You can create and revoke API keys from the Settings page of any project.
            </p>

            <h2 style={h2Style}>Request format</h2>
            <CodeBlock
              lang="http"
              code={`Authorization: Bearer vb_live_your_api_key_here`}
            />

            <h2 style={h2Style}>Key types</h2>
            <div
              style={{
                background: "#161616",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12,
                overflow: "hidden",
                marginBottom: 24,
              }}
            >
              {[
                { prefix: "vb_live_", label: "Live key", desc: "Full access. Use in production." },
                { prefix: "vb_test_", label: "Test key", desc: "Returns mock data. Use in development." },
              ].map((k, i) => (
                <div
                  key={k.prefix}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "160px 100px 1fr",
                    gap: 16,
                    padding: "14px 20px",
                    borderBottom: i === 0 ? "1px solid rgba(255,255,255,0.06)" : "none",
                    alignItems: "center",
                  }}
                >
                  <code style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 13, color: "#00e87b" }}>{k.prefix}…</code>
                  <span style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 13, color: "#f0f0f0", fontWeight: 500 }}>{k.label}</span>
                  <span style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 13, color: "#888888" }}>{k.desc}</span>
                </div>
              ))}
            </div>

            <h2 style={h2Style}>Rate limits</h2>
            <div
              style={{
                background: "#161616",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12,
                overflow: "hidden",
                marginBottom: 24,
              }}
            >
              {[
                { plan: "Seed", limit: "100 req / min" },
                { plan: "Growth", limit: "500 req / min" },
                { plan: "VC Suite", limit: "Unlimited" },
              ].map((r, i) => (
                <div
                  key={r.plan}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    padding: "14px 20px",
                    borderBottom: i < 2 ? "1px solid rgba(255,255,255,0.06)" : "none",
                  }}
                >
                  <span style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 14, color: "#888888" }}>{r.plan}</span>
                  <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 13, color: "#f0f0f0" }}>{r.limit}</span>
                </div>
              ))}
            </div>
            <p style={pStyle}>Rate limit headers are included in every response: <code style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 13, color: "#00e87b" }}>X-RateLimit-Remaining</code> and <code style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 13, color: "#00e87b" }}>X-RateLimit-Reset</code>.</p>
          </div>

          {/* Connect Wallets */}
          <div id="wallets" style={dividerStyle}>
            <span style={labelStyle}>Integrations</span>
            <h1 style={h1Style}>Connect Wallets</h1>
            <p style={pStyle}>
              VaultBrief connects to wallets using public addresses only. We never request or store private keys. Wallet balances and transaction history are fetched using read-only RPC calls via Alchemy.
            </p>

            <h2 style={h2Style}>Supported chains</h2>
            <div className="vb-grid-3" style={{ gap: 12, marginBottom: 32 }}>
              {["Ethereum", "Arbitrum", "Polygon", "Base", "Optimism", "Solana"].map((chain) => (
                <div
                  key={chain}
                  style={{
                    background: "#161616",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 8,
                    padding: "12px 16px",
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 14,
                    color: "#f0f0f0",
                  }}
                >
                  {chain}
                </div>
              ))}
            </div>

            <h2 style={h2Style}>Add a wallet via the dashboard</h2>
            <p style={pStyle}>
              Go to your project → Wallets → Add wallet. Paste a public address and select the chain. VaultBrief will begin syncing balances immediately. The initial sync may take up to 60 seconds for wallets with extensive transaction history.
            </p>

            <h2 style={h2Style}>Add a wallet via the API</h2>
            <CodeBlock
              lang="javascript"
              code={`const res = await fetch('https://api.vaultbrief.com/v1/wallets', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer vb_live_your_api_key',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    project_id: 'proj_abc123',
    address: '0x1234...abcd',
    chain: 'ethereum',
    label: 'Operations multisig',
  }),
});`}
            />

            <h2 style={h2Style}>Gnosis Safe support</h2>
            <p style={pStyle}>
              Gnosis Safe multisigs are fully supported on all EVM chains. VaultBrief connects to the Safe Transaction Service API to decode internal transfers, batch calls, and module interactions correctly. Safe wallets are treated as first-class citizens — not an afterthought.
            </p>
          </div>

          {/* GitHub Setup */}
          <div id="github" style={dividerStyle}>
            <span style={labelStyle}>Integrations</span>
            <h1 style={h1Style}>GitHub Setup</h1>
            <p style={pStyle}>
              Connect your GitHub organization to pull development activity into every monthly report. VaultBrief reads commits, merged pull requests, active contributors, and releases from the previous month.
            </p>

            <h2 style={h2Style}>How to connect</h2>
            {[
              "Go to your project → Settings → Integrations.",
              "Click Connect GitHub Organization.",
              "Authorize VaultBrief via the GitHub OAuth flow. You'll be asked to select which organization to grant access to.",
              "VaultBrief requests read-only access to repository metadata and commit history. We do not read code contents.",
            ].map((step, i) => (
              <p key={i} style={{ ...pStyle, paddingLeft: 0 }}>
                <strong style={{ color: "#f0f0f0" }}>{i + 1}.</strong> {step}
              </p>
            ))}

            <h2 style={h2Style}>What gets pulled</h2>
            <div
              style={{
                background: "#161616",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12,
                overflow: "hidden",
                marginBottom: 24,
              }}
            >
              {[
                { metric: "Commits", desc: "Total commits across all repos in the org, for the report month." },
                { metric: "PRs merged", desc: "Merged pull requests during the report period." },
                { metric: "Active contributors", desc: "Unique authors with at least one commit that month." },
                { metric: "Releases", desc: "Tags and GitHub releases published during the period." },
              ].map((row, i) => (
                <div
                  key={row.metric}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "160px 1fr",
                    padding: "14px 20px",
                    borderBottom: i < 3 ? "1px solid rgba(255,255,255,0.06)" : "none",
                  }}
                >
                  <span style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 14, color: "#f0f0f0", fontWeight: 500 }}>{row.metric}</span>
                  <span style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 14, color: "#888888" }}>{row.desc}</span>
                </div>
              ))}
            </div>

            <p style={pStyle}>
              GitHub data is synced once on the 1st of each month when your monthly report is generated. You can also trigger a manual sync from the Settings page.
            </p>
          </div>

          {/* Alchemy */}
          <div id="alchemy" style={dividerStyle}>
            <span style={labelStyle}>Integrations</span>
            <h1 style={h1Style}>Alchemy</h1>
            <p style={pStyle}>
              VaultBrief uses Alchemy to fetch EVM token balances, transaction history, and NFT positions. You can use VaultBrief's shared Alchemy key on the Seed plan, or bring your own key on Growth and VC Suite for higher rate limits and priority access.
            </p>

            <h2 style={h2Style}>Using your own Alchemy API key</h2>
            {[
              "Create an account at alchemy.com and create a new app.",
              "Select the chains you use (Ethereum, Arbitrum, Base, etc.).",
              "Copy the API key from the app dashboard.",
              "Paste it in VaultBrief → Settings → API Keys → Alchemy.",
            ].map((step, i) => (
              <p key={i} style={pStyle}>
                <strong style={{ color: "#f0f0f0" }}>{i + 1}.</strong> {step}
              </p>
            ))}

            <p style={pStyle}>
              With a custom key, VaultBrief makes all RPC calls using your Alchemy account's allocation. This gives you full visibility into request volume and lets you set your own rate limits.
            </p>
          </div>

          {/* Dune Analytics */}
          <div id="dune" style={dividerStyle}>
            <span style={labelStyle}>Integrations</span>
            <h1 style={h1Style}>Dune Analytics</h1>
            <p style={pStyle}>
              VaultBrief uses Dune Analytics to fetch token holder counts, circulating supply, and on-chain protocol metrics. This data appears in the Token Metrics section of your monthly reports.
            </p>

            <h2 style={h2Style}>Connecting Dune</h2>
            <p style={pStyle}>
              Go to Settings → API Keys → Dune and enter your Dune API key. Keys are available from your Dune account settings. The free tier is sufficient for monthly report generation; paid tiers give faster query execution.
            </p>

            <h2 style={h2Style}>What Dune fetches</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
              {[
                "Token holder count at the end of the report period",
                "Circulating supply (excludes locked and vesting tokens)",
                "30-day price history for token charts",
                "Protocol TVL if your token contract is indexed on Dune",
              ].map((item) => (
                <div key={item} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ color: "#00e87b", flexShrink: 0, marginTop: 2 }}>→</span>
                  <span style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 14.5, color: "#888888", lineHeight: 1.6 }}>{item}</span>
                </div>
              ))}
            </div>

            <p style={pStyle}>
              Dune is optional. If no key is provided, token metrics in reports will show "data unavailable" for holder count and supply figures.
            </p>
          </div>

          {/* API — Projects */}
          <div id="api-projects" style={dividerStyle}>
            <span style={labelStyle}>API Reference</span>
            <h1 style={h1Style}>Projects</h1>
            <p style={pStyle}>Projects represent your DAO, protocol, or startup. Each project has its own wallets, investor list, and report history.</p>

            <h3 style={h3Style}>List projects</h3>
            <EndpointBadge method="GET" path="/v1/projects" />
            <CodeBlock
              lang="javascript"
              code={`const res = await fetch('https://api.vaultbrief.com/v1/projects', {
  headers: { 'Authorization': 'Bearer vb_live_...' },
});
const { projects } = await res.json();
// [{ id, name, tokenSymbol, chain, createdAt }, ...]`}
            />

            <h3 style={h3Style}>Create a project</h3>
            <EndpointBadge method="POST" path="/v1/projects" />
            <CodeBlock
              lang="javascript"
              code={`const res = await fetch('https://api.vaultbrief.com/v1/projects', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer vb_live_...',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'Meridian Protocol',
    tokenSymbol: 'MRD',
    chain: 'ethereum',
    githubOrg: 'meridian-protocol',  // optional
  }),
});
const { project } = await res.json();
// { id: 'proj_abc123', name: 'Meridian Protocol', ... }`}
            />
          </div>

          {/* API — Reports */}
          <div id="api-reports" style={dividerStyle}>
            <span style={labelStyle}>API Reference</span>
            <h1 style={h1Style}>Reports</h1>
            <p style={pStyle}>Reports are generated monthly from on-chain data. Each report includes a treasury snapshot, burn analysis, development activity, and an AI-generated executive summary.</p>

            <h3 style={h3Style}>Generate a report</h3>
            <EndpointBadge method="POST" path="/v1/reports/generate" />
            <CodeBlock
              lang="javascript"
              code={`const res = await fetch('https://api.vaultbrief.com/v1/reports/generate', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer vb_live_...',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    project_id: 'proj_abc123',
    period: '2026-04',   // YYYY-MM
  }),
});
const { report_id, status } = await res.json();
// { report_id: 'rpt_xyz789', status: 'generating' }`}
            />

            <h3 style={h3Style}>Get a report</h3>
            <EndpointBadge method="GET" path="/v1/reports/{report_id}" />
            <CodeBlock
              lang="javascript"
              code={`const res = await fetch('https://api.vaultbrief.com/v1/reports/rpt_xyz789', {
  headers: { 'Authorization': 'Bearer vb_live_...' },
});
const report = await res.json();
// {
//   id, project_id, period, status,
//   treasury_total_usd, burn_rate_usd, runway_months,
//   pdf_url, content_md, created_at
// }`}
            />

            <h3 style={h3Style}>Report status values</h3>
            <div
              style={{
                background: "#161616",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12,
                overflow: "hidden",
                marginBottom: 16,
              }}
            >
              {[
                { status: "generating", desc: "Report is being generated. Poll every 5 seconds until status changes." },
                { status: "draft", desc: "Generation complete. Awaiting founder review." },
                { status: "review", desc: "Marked ready to send." },
                { status: "sent", desc: "Delivered to investor list." },
              ].map((row, i) => (
                <div
                  key={row.status}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "120px 1fr",
                    padding: "14px 20px",
                    borderBottom: i < 3 ? "1px solid rgba(255,255,255,0.06)" : "none",
                  }}
                >
                  <code style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 13, color: "#00e87b" }}>{row.status}</code>
                  <span style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 14, color: "#888888" }}>{row.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* API — Wallets */}
          <div id="api-wallets" style={dividerStyle}>
            <span style={labelStyle}>API Reference</span>
            <h1 style={h1Style}>Wallets</h1>
            <p style={pStyle}>Manage the wallet addresses associated with a project.</p>

            <h3 style={h3Style}>List wallets</h3>
            <EndpointBadge method="GET" path="/v1/wallets?project_id={id}" />
            <CodeBlock
              lang="javascript"
              code={`const res = await fetch(
  'https://api.vaultbrief.com/v1/wallets?project_id=proj_abc123',
  { headers: { 'Authorization': 'Bearer vb_live_...' } }
);
const { wallets } = await res.json();
// [{ id, address, chain, label, balance_usd, last_synced_at }, ...]`}
            />

            <h3 style={h3Style}>Add a wallet</h3>
            <EndpointBadge method="POST" path="/v1/wallets" />
            <CodeBlock
              lang="javascript"
              code={`const res = await fetch('https://api.vaultbrief.com/v1/wallets', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer vb_live_...',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    project_id: 'proj_abc123',
    address: '0xAbCd...1234',
    chain: 'arbitrum',
    label: 'Grants treasury',
  }),
});`}
            />

            <h3 style={h3Style}>Remove a wallet</h3>
            <EndpointBadge method="DELETE" path="/v1/wallets/{wallet_id}" />
            <p style={pStyle}>Removing a wallet stops future syncing but does not delete historical balance data from previous reports.</p>
          </div>

          {/* API — Investors */}
          <div id="api-investors" style={dividerStyle}>
            <span style={labelStyle}>API Reference</span>
            <h1 style={h1Style}>Investors</h1>
            <p style={pStyle}>Manage the investor list for a project. Investors receive a read-only link to each monthly report when it is marked as sent.</p>

            <h3 style={h3Style}>List investors</h3>
            <EndpointBadge method="GET" path="/v1/investors?project_id={id}" />
            <CodeBlock
              lang="javascript"
              code={`const res = await fetch(
  'https://api.vaultbrief.com/v1/investors?project_id=proj_abc123',
  { headers: { 'Authorization': 'Bearer vb_live_...' } }
);
const { investors } = await res.json();
// [{ id, name, email, firm, added_at }, ...]`}
            />

            <h3 style={h3Style}>Add an investor</h3>
            <EndpointBadge method="POST" path="/v1/investors" />
            <CodeBlock
              lang="javascript"
              code={`const res = await fetch('https://api.vaultbrief.com/v1/investors', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer vb_live_...',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    project_id: 'proj_abc123',
    name: 'Alex Chen',
    email: 'alex@meridianvc.com',
    firm: 'Meridian Ventures',  // optional
  }),
});`}
            />
          </div>

          {/* API — Webhooks */}
          <div id="api-webhooks" style={dividerStyle}>
            <span style={labelStyle}>API Reference</span>
            <h1 style={h1Style}>Webhooks</h1>
            <p style={pStyle}>
              VaultBrief sends webhook events to your endpoint when key actions occur. Configure your webhook URL in Settings → Webhooks.
            </p>

            <h2 style={h2Style}>Event types</h2>
            <div
              style={{
                background: "#161616",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12,
                overflow: "hidden",
                marginBottom: 24,
              }}
            >
              {[
                { event: "report.generated", desc: "A report finished generating and is ready for review." },
                { event: "report.sent", desc: "A report was marked as sent and delivered to investors." },
                { event: "wallet.synced", desc: "A wallet balance sync completed." },
                { event: "wallet.error", desc: "A wallet sync failed. Check address and chain configuration." },
              ].map((row, i) => (
                <div
                  key={row.event}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "220px 1fr",
                    padding: "14px 20px",
                    borderBottom: i < 3 ? "1px solid rgba(255,255,255,0.06)" : "none",
                  }}
                >
                  <code style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 13, color: "#00e87b" }}>{row.event}</code>
                  <span style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 14, color: "#888888" }}>{row.desc}</span>
                </div>
              ))}
            </div>

            <h2 style={h2Style}>Payload format</h2>
            <CodeBlock
              lang="json"
              code={`{
  "event": "report.generated",
  "timestamp": "2026-05-01T08:00:00Z",
  "data": {
    "report_id": "rpt_xyz789",
    "project_id": "proj_abc123",
    "period": "2026-04",
    "status": "draft",
    "pdf_url": "https://cdn.vaultbrief.com/reports/rpt_xyz789.pdf"
  }
}`}
            />

            <h2 style={h2Style}>Verifying signatures</h2>
            <p style={pStyle}>
              Every webhook request includes a <code style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 13, color: "#00e87b" }}>X-VaultBrief-Signature</code> header containing an HMAC-SHA256 signature of the raw request body. Verify it using your webhook signing secret from Settings.
            </p>
            <CodeBlock
              lang="javascript"
              code={`import crypto from 'crypto';

function verifyWebhook(rawBody, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}`}
            />
          </div>

          {/* SDK — JavaScript */}
          <div id="sdk-js" style={dividerStyle}>
            <span style={labelStyle}>SDK</span>
            <h1 style={h1Style}>JavaScript / TypeScript</h1>
            <p style={pStyle}>The official VaultBrief JavaScript SDK wraps the REST API with full TypeScript types.</p>

            <h2 style={h2Style}>Installation</h2>
            <CodeBlock lang="bash" code={`npm install vaultbrief`} />

            <h2 style={h2Style}>Usage</h2>
            <CodeBlock
              lang="typescript"
              code={`import { VaultBrief } from 'vaultbrief';

const client = new VaultBrief({ apiKey: process.env.VAULTBRIEF_API_KEY });

// List all projects
const { projects } = await client.projects.list();

// Generate a report
const report = await client.reports.generate({
  projectId: 'proj_abc123',
  period: '2026-04',
});

// Poll until ready
const ready = await client.reports.waitForCompletion(report.id);
console.log(ready.pdfUrl);`}
            />

            <h2 style={h2Style}>TypeScript types</h2>
            <p style={pStyle}>All API responses are typed. Import types directly:</p>
            <CodeBlock
              lang="typescript"
              code={`import type { Project, Report, Wallet, Investor } from 'vaultbrief';`}
            />
          </div>

          {/* SDK — Python */}
          <div id="sdk-python" style={dividerStyle}>
            <span style={labelStyle}>SDK</span>
            <h1 style={h1Style}>Python</h1>
            <p style={pStyle}>The VaultBrief Python SDK supports Python 3.9+.</p>

            <h2 style={h2Style}>Installation</h2>
            <CodeBlock lang="bash" code={`pip install vaultbrief`} />

            <h2 style={h2Style}>Usage</h2>
            <CodeBlock
              lang="python"
              code={`from vaultbrief import VaultBrief

client = VaultBrief(api_key="vb_live_your_api_key")

# List projects
projects = client.projects.list()

# Generate a report for April 2026
report = client.reports.generate(
    project_id="proj_abc123",
    period="2026-04",
)

# Wait for generation to complete
ready = client.reports.wait_for_completion(report.id)
print(ready.pdf_url)`}
            />
          </div>

          {/* SDK — Examples */}
          <div id="sdk-examples" style={dividerStyle}>
            <span style={labelStyle}>SDK</span>
            <h1 style={h1Style}>Examples</h1>

            <h2 style={h2Style}>Automate monthly reporting via cron</h2>
            <p style={pStyle}>Run this on the 1st of every month to generate and send reports for all your projects:</p>
            <CodeBlock
              lang="typescript"
              code={`import { VaultBrief } from 'vaultbrief';

const client = new VaultBrief({ apiKey: process.env.VAULTBRIEF_API_KEY });

async function runMonthlyReports() {
  const now = new Date();
  const period = \`\${now.getFullYear()}-\${String(now.getMonth()).padStart(2, '0')}\`;

  const { projects } = await client.projects.list();

  for (const project of projects) {
    const report = await client.reports.generate({
      projectId: project.id,
      period,
    });

    const ready = await client.reports.waitForCompletion(report.id);
    await client.reports.send(ready.id);

    console.log(\`Sent \${project.name} report for \${period}\`);
  }
}

runMonthlyReports();`}
            />

            <h2 style={h2Style}>Add investors from a CSV</h2>
            <CodeBlock
              lang="typescript"
              code={`import { VaultBrief } from 'vaultbrief';
import { parse } from 'csv-parse/sync';
import fs from 'fs';

const client = new VaultBrief({ apiKey: process.env.VAULTBRIEF_API_KEY });

const csv = fs.readFileSync('investors.csv', 'utf8');
const rows = parse(csv, { columns: true });

for (const row of rows) {
  await client.investors.create({
    projectId: 'proj_abc123',
    name: row.name,
    email: row.email,
    firm: row.firm,
  });
  console.log(\`Added \${row.name}\`);
}`}
            />

            <h2 style={h2Style}>Receive a webhook and verify it</h2>
            <CodeBlock
              lang="typescript"
              code={`import express from 'express';
import crypto from 'crypto';

const app = express();
app.use(express.raw({ type: 'application/json' }));

app.post('/webhooks/vaultbrief', (req, res) => {
  const sig = req.headers['x-vaultbrief-signature'] as string;
  const secret = process.env.VAULTBRIEF_WEBHOOK_SECRET!;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(req.body)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(req.body.toString());

  if (event.event === 'report.generated') {
    console.log('New report ready:', event.data.report_id);
    // notify your team, trigger a Slack message, etc.
  }

  res.sendStatus(200);
});`}
            />
          </div>

        </main>
      </div>
    </div>
  );
}
