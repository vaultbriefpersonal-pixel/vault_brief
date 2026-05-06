/**
 * Snapshot.org governance proposal importer.
 *
 * Snapshot's public GraphQL endpoint at https://hub.snapshot.org/graphql
 * is open and unauthenticated; we just hit it with a date-range query
 * for a given space and return shaped rows ready to insert into the
 * `governance_proposals` table.
 *
 * Status mapping:
 *   - "active"  → "active"   (vote in progress)
 *   - "pending" → "submitted" (proposal posted, voting hasn't opened)
 *   - "closed"  → "passed"   (default; founder can edit to 'rejected'
 *                              for proposals that failed)
 *
 * Vote-result formatting builds a "Yes 78% / No 22% (14M tokens)"
 * style string from the choices + scores arrays. Returns empty string
 * if scores haven't finalized yet (e.g. active proposal).
 */

const SNAPSHOT_GRAPHQL = "https://hub.snapshot.org/graphql";

export interface SnapshotProposal {
  id: string;
  title: string;
  state: "pending" | "active" | "closed";
  link: string | null;
  scores: number[];
  scores_total: number;
  choices: string[];
  created: number;
  end: number;
}

export interface ImportablePropoosalRow {
  title: string;
  status: "submitted" | "active" | "passed" | "rejected";
  url: string | null;
  voteResult: string | null;
}

/**
 * Fetch proposals created within `period` (YYYY-MM) for `space`.
 * Returns up to 100 proposals — Snapshot's max-per-call limit.
 */
export async function fetchSnapshotProposals(
  space: string,
  period: string
): Promise<SnapshotProposal[]> {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new Error(`Invalid period '${period}', expected YYYY-MM`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const start = Math.floor(Date.UTC(year, month - 1, 1) / 1000);
  const end = Math.floor(Date.UTC(year, month, 1) / 1000) - 1;

  const query = `
    query Proposals($space: String!, $start: Int!, $end: Int!) {
      proposals(
        first: 100
        where: { space: $space, created_gte: $start, created_lte: $end }
        orderBy: "created"
        orderDirection: desc
      ) {
        id
        title
        state
        link
        scores
        scores_total
        choices
        created
        end
      }
    }
  `;

  const res = await fetch(SNAPSHOT_GRAPHQL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { space, start, end } }),
  });
  if (!res.ok) {
    throw new Error(`Snapshot API HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    data?: { proposals?: SnapshotProposal[] };
    errors?: unknown;
  };
  if (data.errors) {
    throw new Error(`Snapshot API: ${JSON.stringify(data.errors)}`);
  }
  return data.data?.proposals ?? [];
}

export function mapProposalToRow(p: SnapshotProposal): ImportablePropoosalRow {
  return {
    title: p.title,
    status:
      p.state === "active"
        ? "active"
        : p.state === "pending"
          ? "submitted"
          : "passed",
    url: p.link,
    voteResult: formatVoteResult(p),
  };
}

function formatVoteResult(p: SnapshotProposal): string | null {
  // No scores → don't fabricate a result line. Active and pending
  // proposals reach the section with `voteResult: null`.
  if (!p.scores_total || p.scores_total <= 0) return null;
  if (!p.choices?.length || !p.scores?.length) return null;

  const pct = (s: number) => `${Math.round((s / p.scores_total) * 100)}%`;
  const pairs = p.choices
    .map((c, i) => `${c} ${pct(p.scores[i] ?? 0)}`)
    .join(" / ");
  return `${pairs} (${formatTokens(p.scores_total)} voting power)`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}
