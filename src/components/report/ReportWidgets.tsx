import type { TreasurySnapshot } from "@/server/db/schema";
import { formatUsd } from "@/lib/utils";
import { TreasuryChart } from "@/components/charts/TreasuryChart";
import { BurnRateChart } from "@/components/charts/BurnRateChart";

/**
 * Investor-report widget strip.
 *
 * Mounts above the markdown narrative on both `/r/[reportId]` (public
 * investor view) and `/projects/[id]/reports/[reportId]` (founder editor)
 * so the actual report surfaces match what the marketing demo at /demo
 * promises — KPI tiles, treasury composition, expense breakdown, token
 * metrics, GitHub activity.
 *
 * Every block null-checks its source field and self-hides when missing
 * so:
 *   - reports without a linked snapshot render exactly as today
 *     (markdown-only fallback);
 *   - projects without a public token don't get an empty token block;
 *   - early-stage projects with no GitHub config don't get a 0/0/0 tile.
 *
 * The `accent` prop is the project's custom brand color (or the default
 * #00e87b). It's threaded through bar fills and the GitHub-tile values
 * so a custom-branded report uses the project's color, not VaultBrief's.
 *
 * Visual vocabulary intentionally mirrors src/app/(marketing)/demo/page.tsx
 * — same KPI tile shape, same BarRow stacked-div bar, same GitHub centered
 * tile. /demo keeps its own bespoke inline JSX (per product decision); this
 * component owns the real-product rendering.
 */

interface SafeInfo {
  walletId: string;
  chain: string;
  address: string;
  label: string | null;
  ownerCount: number;
  threshold: number;
  /** Undefined when the Safe Transaction Service call failed — omit the
   * pending line rather than imply "zero pending" incorrectly. */
  pendingCount?: number;
  oldestPendingDate?: string | null;
}

interface TrendData {
  treasury: { date: string; totalBalanceUsd: number }[];
  burn: { date: string; burnRateUsd: number }[];
}

interface ReportWidgetsProps {
  snapshot: TreasurySnapshot | null | undefined;
  accent: string;
  /** Signer/threshold info for any gnosis_safe-tagged wallets, read live
   * on-chain (see safe-info.ts). Omit or pass [] when there are none —
   * the block self-hides, same null-safe philosophy as every block here. */
  safes?: SafeInfo[];
  /** Trailing treasury/burn history (see projects.getSnapshotTrend).
   * Renders nothing below 2 points — a single snapshot makes a
   * degenerate line, and the trend's whole point is showing change
   * over time. TreasuryChart/BurnRateChart have their own richer
   * 0/1-point states for the dashboard; the report surface just omits
   * the block entirely rather than showing "no data yet" to an investor. */
  trend?: TrendData;
}

export function ReportWidgets({
  snapshot,
  accent,
  safes = [],
  trend,
}: ReportWidgetsProps) {
  if (!snapshot) return null;

  const showTrend = (trend?.treasury.length ?? 0) >= 2;

  const total = num(snapshot.totalBalanceUsd);
  const inflows = num(snapshot.totalInflowsUsd);
  const outflows = num(snapshot.totalOutflowsUsd);
  const netFlow = num(snapshot.netFlowUsd) || inflows - outflows;
  const tokenPrice = num(snapshot.tokenPriceUsd);

  // Composition slices — drop zero-value to avoid rendering empty bars.
  const composition: Slice[] = [
    { label: "Stablecoins", usd: num(snapshot.stablecoinsUsd), color: accent },
    { label: "ETH / WETH", usd: num(snapshot.ethUsd), color: "#4f9cf9" },
    { label: "Native token", usd: num(snapshot.nativeTokenUsd), color: "#a78bfa" },
    { label: "Other assets", usd: num(snapshot.otherAssetsUsd), color: "var(--vb-dim)" },
  ].filter((s) => s.usd > 0);

  // Expenses — pull from JSONB, sort desc, collapse long tail into "Other".
  const expenses = expenseSlices(snapshot.expensesByCategory, accent);

  // KPI strip — render only the tiles whose source data exists.
  const kpis: KpiTile[] = [
    total > 0 ? { label: "Total balance", val: formatUsd(total) } : null,
    Number.isFinite(netFlow) && netFlow !== 0
      ? {
          label: "Monthly net flow",
          val: `${netFlow >= 0 ? "+" : ""}${formatUsd(netFlow)}`,
          tone: netFlow >= 0 ? "positive" : "negative",
        }
      : null,
    inflows > 0 ? { label: "Inflows", val: formatUsd(inflows), tone: "positive" } : null,
    tokenPrice > 0
      ? { label: "Token price", val: `$${tokenPrice.toFixed(tokenPrice < 1 ? 4 : 2)}` }
      : null,
  ].filter((t): t is KpiTile => t !== null);

  // Token metrics block — hide entirely when the project doesn't track a token.
  const hasToken = tokenPrice > 0;
  const tokenMetrics = hasToken
    ? [
        {
          label: "Token price",
          val: `$${tokenPrice.toFixed(tokenPrice < 1 ? 4 : 2)}`,
          note: "snapshot close",
        },
        num(snapshot.tokenMarketCapUsd) > 0
          ? {
              label: "Market cap",
              val: formatUsd(num(snapshot.tokenMarketCapUsd)),
              note: "circulating",
            }
          : null,
        snapshot.tokenHoldersCount != null
          ? {
              label: "Holders",
              val: compactCount(snapshot.tokenHoldersCount),
              note: "ERC-20 wallets",
            }
          : null,
        num(snapshot.tokenCirculatingSupply) > 0
          ? {
              label: "Circulating supply",
              val: compactCount(num(snapshot.tokenCirculatingSupply)),
              note: "tokens",
            }
          : null,
      ].filter(Boolean)
    : [];

  // GitHub block — hide entirely when project has no GitHub configured.
  const ghCommits = snapshot.githubCommitsCount ?? 0;
  const ghPrs = snapshot.githubPrsMerged ?? 0;
  const ghContribs = snapshot.githubContributorsActive ?? 0;
  const hasGitHub = ghCommits > 0 || ghPrs > 0 || ghContribs > 0;

  // Render absolutely nothing if every block self-hides — keeps reports
  // with no usable snapshot data from leaving an empty panel on the page.
  const renderable =
    kpis.length > 0 ||
    composition.length > 0 ||
    expenses.length > 0 ||
    tokenMetrics.length > 0 ||
    hasGitHub ||
    safes.length > 0 ||
    showTrend;
  if (!renderable) return null;

  return (
    <div
      style={{
        padding: "24px 28px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 32,
      }}
    >
      {kpis.length > 0 && (
        <div className="vb-grid-4" style={{ gap: 16 }}>
          {kpis.map((k) => (
            <KpiTileView key={k.label} {...k} />
          ))}
        </div>
      )}

      {(composition.length > 0 || expenses.length > 0) && (
        <div className="vb-grid-2" style={{ gap: 24 }}>
          {composition.length > 0 && (
            <Panel title="Treasury composition">
              {composition.map((s) => (
                <BarRow
                  key={s.label}
                  label={s.label}
                  value={formatUsd(s.usd)}
                  pct={total > 0 ? Math.round((s.usd / total) * 100) : 0}
                  color={s.color}
                />
              ))}
            </Panel>
          )}
          {expenses.length > 0 && (
            <Panel title="Expense breakdown">
              {expenses.map((e) => (
                <BarRow
                  key={e.label}
                  label={e.label}
                  value={formatUsd(e.usd)}
                  pct={e.pct}
                  color={accent}
                  barOpacity={0.4 + e.pct / 100}
                />
              ))}
            </Panel>
          )}
        </div>
      )}

      {showTrend && trend && (
        <div className="vb-grid-2" style={{ gap: 24 }}>
          <Panel title="Treasury over time">
            <TreasuryChart data={trend.treasury} />
          </Panel>
          <Panel title="Burn rate over time">
            <BurnRateChart data={trend.burn} />
          </Panel>
        </div>
      )}

      {tokenMetrics.length > 0 && (
        <div>
          <SectionHeading subtitle="From CoinGecko + on-chain queries">
            Token metrics
          </SectionHeading>
          <div className="vb-grid-4" style={{ gap: 16 }}>
            {tokenMetrics.map((m) => (
              <MetricTileView key={m!.label} {...(m as MetricTile)} />
            ))}
          </div>
        </div>
      )}

      {hasGitHub && (
        <div>
          <SectionHeading subtitle="From GitHub API">
            GitHub activity
          </SectionHeading>
          <div
            style={{
              background: "var(--vb-bg)",
              borderRadius: 12,
              border: "1px solid var(--vb-border)",
              padding: 24,
            }}
          >
            <div className="vb-grid-3" style={{ gap: 16 }}>
              {[
                { label: "Commits", val: ghCommits },
                { label: "PRs merged", val: ghPrs },
                { label: "Active contributors", val: ghContribs },
              ].map((g) => (
                <div key={g.label} style={{ textAlign: "center" }}>
                  <p
                    style={{
                      fontFamily:
                        "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                      fontSize: 32,
                      fontWeight: 700,
                      color: accent,
                      margin: "0 0 4px",
                    }}
                  >
                    {g.val}
                  </p>
                  <p
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 13,
                      color: "var(--vb-muted)",
                      margin: 0,
                    }}
                  >
                    {g.label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {safes.length > 0 && (
        <div>
          <SectionHeading subtitle="Verified live on-chain">
            Treasury security
          </SectionHeading>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {safes.map((s) => (
              <div
                key={s.walletId}
                style={{
                  background: "var(--vb-bg)",
                  border: "1px solid var(--vb-border)",
                  borderRadius: 10,
                  padding: "12px 16px",
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 14,
                  color: "var(--vb-text)",
                }}
              >
                <strong style={{ color: accent }}>
                  Secured by a {s.threshold}-of-{s.ownerCount} multisig
                </strong>
                {s.label ? (
                  <span style={{ color: "var(--vb-muted)" }}> — {s.label}</span>
                ) : null}
                {s.pendingCount ? (
                  <div
                    style={{
                      color: "var(--vb-muted)",
                      fontSize: 12,
                      marginTop: 4,
                    }}
                  >
                    {s.pendingCount} transaction
                    {s.pendingCount === 1 ? "" : "s"} awaiting signature
                    {s.oldestPendingDate
                      ? ` (oldest: ${pendingAgeLabel(s.oldestPendingDate)})`
                      : ""}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── building blocks (mirror /demo visual vocabulary) ───────────────────

interface Slice {
  label: string;
  usd: number;
  color: string;
}

interface KpiTile {
  label: string;
  val: string;
  tone?: "positive" | "negative";
}

interface MetricTile {
  label: string;
  val: string;
  note: string;
}

function KpiTileView({ label, val, tone }: KpiTile) {
  const toneColor =
    tone === "positive"
      ? "#00e87b"
      : tone === "negative"
        ? "#f87171"
        : "var(--vb-text)";
  return (
    <div
      style={{
        background: "var(--vb-bg)",
        borderRadius: 10,
        padding: "20px 16px",
        border: "1px solid var(--vb-border)",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 11,
          color: "var(--vb-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          margin: "0 0 8px",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 22,
          fontWeight: 700,
          color: toneColor,
          margin: 0,
        }}
      >
        {val}
      </p>
    </div>
  );
}

function MetricTileView({ label, val, note }: MetricTile) {
  return (
    <div
      style={{
        background: "var(--vb-bg)",
        borderRadius: 10,
        padding: "20px 16px",
        border: "1px solid var(--vb-border)",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 11,
          color: "var(--vb-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          margin: "0 0 8px",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 20,
          fontWeight: 700,
          color: "var(--vb-text)",
          margin: "0 0 4px",
        }}
      >
        {val}
      </p>
      <p
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 12,
          color: "var(--vb-muted)",
          margin: 0,
        }}
      >
        {note}
      </p>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--vb-bg)",
        borderRadius: 12,
        border: "1px solid var(--vb-border)",
        padding: 24,
      }}
    >
      <h3
        style={{
          fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 15,
          fontWeight: 600,
          color: "var(--vb-text)",
          margin: "0 0 20px",
        }}
      >
        {title}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {children}
      </div>
    </div>
  );
}

function SectionHeading({
  children,
  subtitle,
}: {
  children: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3
        style={{
          fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontSize: 16,
          fontWeight: 600,
          color: "var(--vb-text)",
          margin: 0,
          letterSpacing: "-0.01em",
        }}
      >
        {children}
      </h3>
      {subtitle && (
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 12,
            color: "var(--vb-dim)",
            margin: "4px 0 0",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

function BarRow({
  label,
  value,
  pct,
  color,
  barOpacity,
}: {
  label: string;
  value: string;
  pct: number;
  color: string;
  barOpacity?: number;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            color: "var(--vb-muted)",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            color: "var(--vb-text)",
            fontWeight: 500,
          }}
        >
          {value}
        </span>
      </div>
      <div
        style={{
          height: 4,
          background: "rgba(255,255,255,0.06)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, Math.max(0, pct))}%`,
            background: color,
            opacity: barOpacity,
            borderRadius: 2,
          }}
        />
      </div>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────

/** Numeric columns come back as `string | null` because of Drizzle's
 * `numeric` mapping — coerce to a clean number with NaN/null → 0. */
function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** "3 days" / "1 day" / "today" for a Safe's oldest pending transaction. */
function pendingAgeLabel(isoDate: string): string {
  const days = Math.floor(
    (Date.now() - new Date(isoDate).getTime()) / 86_400_000
  );
  if (!Number.isFinite(days) || days <= 0) return "today";
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** `expensesByCategory` is JSONB shaped as `{ payroll: 1234, infra: 567, ... }`
 * (per the expense-classifier output). Convert to BarRow slices: sort
 * descending by USD, drop zero / negative entries, collapse the long tail
 * past 5 buckets into a single "Other" row so the panel doesn't sprawl. */
function expenseSlices(
  raw: unknown,
  _accent: string
): { label: string; usd: number; pct: number }[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const entries = Object.entries(obj)
    .map(([k, v]) => ({ label: prettifyCategory(k), usd: num(v) }))
    .filter((e) => e.usd > 0)
    .sort((a, b) => b.usd - a.usd);
  if (entries.length === 0) return [];
  const top = entries.slice(0, 5);
  const tail = entries.slice(5);
  if (tail.length > 0) {
    const otherSum = tail.reduce((s, e) => s + e.usd, 0);
    top.push({ label: "Other", usd: otherSum });
  }
  const total = top.reduce((s, e) => s + e.usd, 0);
  return top.map((e) => ({
    ...e,
    pct: total > 0 ? Math.round((e.usd / total) * 100) : 0,
  }));
}

/** Category keys come in as `snake_case` from the classifier — surface
 * a human label without depending on i18n. `token_sale` deliberately
 * renders as "Treasury operations" because that's the report-prompt
 * convention (it's not really an expense, it's a rebalance). */
function prettifyCategory(key: string): string {
  if (key === "token_sale") return "Treasury operations";
  return key
    .split(/[_\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Compact integer formatter for token holder counts / supply. Keeps
 * everything readable without scientific notation. */
function compactCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}
