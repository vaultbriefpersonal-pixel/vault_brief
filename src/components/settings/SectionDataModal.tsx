"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/api";
import { X, Plus, Trash2, Download } from "lucide-react";
// Client-safe by construction: report-derived.ts imports pure services and
// `import type` on the schema only. The real category unions live in
// expense-classifier.ts, which pulls the OpenAI SDK and must never be
// imported from here — see the mirror note on EXPENSE_CATEGORY_NAMES.
import {
  EXPENSE_CATEGORY_NAMES,
  INCOME_CATEGORY_NAMES,
  TOTAL_BUDGET_CATEGORY,
} from "@/server/services/report-derived";

/**
 * Single modal that handles CRUD for the manual-entry sections:
 *   grants_distributed, governance_updates, partners_integrations,
 *   asks, qa_highlights, milestones_completed / looking_ahead
 *   (both backed by the milestones table).
 *
 * One file per renderer would be cleaner long-term but the forms are
 * tiny enough that putting them all here keeps the diff reviewable
 * and the tRPC plumbing tight. Each renderer is self-contained: own
 * mutations, own list query, own form state.
 *
 * Modal positions itself as a fixed overlay; click outside or Escape
 * to close. Parent passes `onClose` and is responsible for invalidating
 * any dependent queries (like getSectionReadiness).
 */

const SECTION_TITLES: Record<string, string> = {
  actual_vs_budget: "Plan vs Actual",
  grants_distributed: "Grants Distributed",
  governance_updates: "Governance Updates",
  partners_integrations: "Partners & Integrations",
  asks: "Asks",
  qa_highlights: "Q&A Highlights",
  milestones_completed: "Milestones",
  looking_ahead: "Milestones",
};

const PERIOD_RE = /^\d{4}-\d{2}$/;
function defaultPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--vb-alt)",
  border: "1px solid var(--vb-border)",
  borderRadius: 6,
  padding: "9px 12px",
  fontSize: 13,
  color: "var(--vb-text)",
  fontFamily: "var(--font-inter), Inter, sans-serif",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "var(--vb-muted)",
  fontFamily: "var(--font-inter), Inter, sans-serif",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const submitStyle: React.CSSProperties = {
  background: "#00e87b",
  color: "#0a0a0a",
  border: "none",
  borderRadius: 6,
  padding: "8px 14px",
  fontSize: 12,
  fontWeight: 600,
  fontFamily: "var(--font-inter), Inter, sans-serif",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const removeBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 6,
  borderRadius: 4,
  cursor: "pointer",
  color: "#f87171",
  display: "flex",
};

export function SectionDataModal({
  projectId,
  sectionId,
  onClose,
}: {
  projectId: string;
  sectionId: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "10vh 16px 16px",
        zIndex: 100,
        fontFamily: "var(--font-inter), Inter, sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--vb-card)",
          border: "1px solid var(--vb-border)",
          borderRadius: 12,
          width: "100%",
          maxWidth: 640,
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--vb-border)",
            position: "sticky",
            top: 0,
            background: "var(--vb-card)",
            zIndex: 1,
          }}
        >
          <h3
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: 16,
              fontWeight: 700,
              color: "var(--vb-text)",
              margin: 0,
              letterSpacing: "-0.01em",
            }}
          >
            {SECTION_TITLES[sectionId] ?? sectionId}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              padding: 4,
              cursor: "pointer",
              color: "var(--vb-muted)",
              display: "flex",
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 20 }}>
          {sectionId === "actual_vs_budget" && (
            <BudgetRenderer projectId={projectId} />
          )}
          {sectionId === "grants_distributed" && (
            <GrantsRenderer projectId={projectId} />
          )}
          {sectionId === "governance_updates" && (
            <GovernanceRenderer projectId={projectId} />
          )}
          {sectionId === "partners_integrations" && (
            <PartnersRenderer projectId={projectId} />
          )}
          {sectionId === "asks" && <AsksRenderer projectId={projectId} />}
          {sectionId === "qa_highlights" && <QaRenderer projectId={projectId} />}
          {(sectionId === "milestones_completed" ||
            sectionId === "looking_ahead") && (
            <MilestonesRenderer projectId={projectId} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Plan vs Actual ────────────────────────────────────────────────────

/**
 * The budget entry form. Unlike the other renderers this one writes through
 * an UPSERT keyed on (period, kind, category), so saving a category the
 * founder already budgeted edits that row instead of adding a second one —
 * the list below never grows a duplicate the report would double-count.
 *
 * The category picker is a select rather than the free-text field grants uses
 * on purpose: a budget category only means something if it matches the name
 * the classifier writes into the snapshot. A typo here is not a cosmetic
 * problem, it is a plan row that can never find its actual.
 */
function BudgetRenderer({ projectId }: { projectId: string }) {
  const [period, setPeriod] = useState(defaultPeriod());
  const validPeriod = PERIOD_RE.test(period);

  const { data: list = [], refetch } = trpc.projectBudgets.list.useQuery(
    { projectId, period },
    { enabled: validPeriod }
  );
  const upsert = trpc.projectBudgets.upsert.useMutation({
    onSuccess: () => refetch(),
  });
  const remove = trpc.projectBudgets.remove.useMutation({
    onSuccess: () => refetch(),
  });

  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [category, setCategory] = useState(TOTAL_BUDGET_CATEGORY);
  const [plannedUsd, setPlannedUsd] = useState("");
  const [notes, setNotes] = useState("");

  const categories =
    kind === "expense" ? EXPENSE_CATEGORY_NAMES : INCOME_CATEGORY_NAMES;
  const planned = parseFloat(plannedUsd);
  const plannedValid = Number.isFinite(planned) && planned >= 0;

  function submit() {
    if (!validPeriod || !plannedValid) return;
    upsert.mutate(
      {
        projectId,
        period,
        kind,
        category,
        plannedUsd: planned,
        notes: notes || undefined,
      },
      {
        onSuccess: () => {
          setPlannedUsd("");
          setNotes("");
        },
      }
    );
  }

  return (
    <>
      <p
        style={{
          fontSize: 12,
          color: "var(--vb-muted)",
          margin: "0 0 14px",
          lineHeight: 1.5,
        }}
      >
        Enter what you planned to spend or earn this period. One{" "}
        <strong style={{ color: "var(--vb-text)" }}>total</strong> is enough —
        the report compares it against your actual operating spend. Add a
        figure per category if you want a line-by-line table. Saving the same
        category twice replaces the earlier figure.
      </p>

      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "1fr 1fr",
          marginBottom: 16,
        }}
      >
        <div>
          <label style={labelStyle}>Period (YYYY-MM)</label>
          <input
            style={inputStyle}
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder="2026-04"
          />
        </div>
        <div>
          <label style={labelStyle}>Side</label>
          <select
            style={inputStyle}
            value={kind}
            onChange={(e) => {
              // The two namespaces are disjoint, so an unchanged category
              // would be invalid against the new side the moment this flips.
              setKind(e.target.value as "expense" | "income");
              setCategory(TOTAL_BUDGET_CATEGORY);
            }}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Category</label>
          <select
            style={inputStyle}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value={TOTAL_BUDGET_CATEGORY}>
              Single total for the period
            </option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Planned (USD)</label>
          <input
            style={inputStyle}
            type="number"
            min="0"
            value={plannedUsd}
            onChange={(e) => setPlannedUsd(e.target.value)}
            placeholder="180000"
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Notes (optional)</label>
          <input
            style={inputStyle}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Assumes the second audit lands this month"
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <button
            type="button"
            style={submitStyle}
            disabled={!validPeriod || !plannedValid || upsert.isPending}
            onClick={submit}
          >
            <Plus size={12} /> {upsert.isPending ? "Saving…" : "Save budget line"}
          </button>
        </div>
      </div>

      <ItemList
        rows={list}
        empty={
          validPeriod
            ? `No budget entered for ${period} yet.`
            : "Enter a period as YYYY-MM."
        }
        render={(b) => (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{ fontSize: 13, color: "var(--vb-text)", fontWeight: 600 }}
              >
                {b.category === TOTAL_BUDGET_CATEGORY
                  ? "Total for the period"
                  : b.category.replace(/_/g, " ")}{" "}
                — ${Number(b.plannedUsd).toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: "var(--vb-dim)", marginTop: 2 }}>
                {b.kind} · {b.period}
                {b.notes ? ` · ${b.notes}` : ""}
              </div>
            </div>
            <RemoveBtn
              onClick={() => remove.mutate({ projectId, budgetId: b.id })}
            />
          </>
        )}
      />
    </>
  );
}

// ─── Grants ────────────────────────────────────────────────────────────

function GrantsRenderer({ projectId }: { projectId: string }) {
  const { data: list = [], refetch } = trpc.grants.list.useQuery({ projectId });
  const add = trpc.grants.add.useMutation({ onSuccess: () => refetch() });
  const remove = trpc.grants.remove.useMutation({ onSuccess: () => refetch() });

  const [recipient, setRecipient] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [status, setStatus] = useState<"committed" | "disbursed">("committed");
  const [category, setCategory] = useState("");
  const [period, setPeriod] = useState(defaultPeriod());
  const [notes, setNotes] = useState("");

  function submit() {
    if (!recipient || !amountUsd) return;
    add.mutate(
      {
        projectId,
        recipient,
        amountUsd: parseFloat(amountUsd),
        status,
        category: category || undefined,
        period,
        notes: notes || undefined,
      },
      {
        onSuccess: () => {
          setRecipient("");
          setAmountUsd("");
          setCategory("");
          setNotes("");
        },
      }
    );
  }

  return (
    <>
      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "1fr 1fr",
          marginBottom: 16,
        }}
      >
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Recipient</label>
          <input
            style={inputStyle}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Acme Research"
          />
        </div>
        <div>
          <label style={labelStyle}>Amount (USD)</label>
          <input
            style={inputStyle}
            type="number"
            value={amountUsd}
            onChange={(e) => setAmountUsd(e.target.value)}
            placeholder="50000"
          />
        </div>
        <div>
          <label style={labelStyle}>Status</label>
          <select
            style={inputStyle}
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as "committed" | "disbursed")
            }
          >
            <option value="committed">Committed</option>
            <option value="disbursed">Disbursed</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Category (optional)</label>
          <input
            style={inputStyle}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="research / tooling / community"
          />
        </div>
        <div>
          <label style={labelStyle}>Period (YYYY-MM)</label>
          <input
            style={inputStyle}
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder="2026-04"
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Notes (optional)</label>
          <input
            style={inputStyle}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Delivered SDK v2 ahead of schedule"
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <button
            type="button"
            style={submitStyle}
            disabled={
              !recipient || !amountUsd || !PERIOD_RE.test(period) || add.isPending
            }
            onClick={submit}
          >
            <Plus size={12} /> {add.isPending ? "Adding…" : "Add grant"}
          </button>
        </div>
      </div>

      <ItemList
        rows={list}
        empty="No grants yet."
        render={(g) => (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: "var(--vb-text)", fontWeight: 600 }}>
                {g.recipient} — ${Number(g.amountUsd).toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: "var(--vb-dim)", marginTop: 2 }}>
                {g.status} · {g.period}
                {g.category ? ` · ${g.category}` : ""}
              </div>
            </div>
            <RemoveBtn onClick={() => remove.mutate({ id: g.id })} />
          </>
        )}
      />
    </>
  );
}

// ─── Governance ────────────────────────────────────────────────────────

function GovernanceRenderer({ projectId }: { projectId: string }) {
  const { data: list = [], refetch } = trpc.governanceProposals.list.useQuery({
    projectId,
  });
  const { data: project } = trpc.projects.getById.useQuery({ id: projectId });
  const utils = trpc.useUtils();
  const add = trpc.governanceProposals.add.useMutation({
    onSuccess: () => refetch(),
  });
  const remove = trpc.governanceProposals.remove.useMutation({
    onSuccess: () => refetch(),
  });
  const importMut = trpc.governanceProposals.importFromSnapshot.useMutation({
    onSuccess: () => refetch(),
  });
  const updateProject = trpc.projects.update.useMutation({
    onSuccess: () => utils.projects.getById.invalidate({ id: projectId }),
  });

  const [title, setTitle] = useState("");
  const [status, setStatus] =
    useState<"submitted" | "passed" | "rejected" | "active">("submitted");
  const [url, setUrl] = useState("");
  const [voteResult, setVoteResult] = useState("");
  const [period, setPeriod] = useState(defaultPeriod());

  // Snapshot-import state. Pre-fill space from project.snapshotSpace if
  // saved; otherwise founder types it (and we save back on import success).
  const [snapshotSpace, setSnapshotSpace] = useState("");
  useEffect(() => {
    const stored =
      (project as { snapshotSpace?: string | null } | undefined)
        ?.snapshotSpace ?? "";
    if (stored && !snapshotSpace) setSnapshotSpace(stored);
  }, [project, snapshotSpace]);

  const [importMsg, setImportMsg] = useState<string | null>(null);

  function submit() {
    if (!title) return;
    add.mutate(
      {
        projectId,
        title,
        status,
        url: url || undefined,
        voteResult: voteResult || undefined,
        period,
      },
      {
        onSuccess: () => {
          setTitle("");
          setUrl("");
          setVoteResult("");
        },
      }
    );
  }

  async function importFromSnapshot() {
    if (!snapshotSpace.trim()) return;
    setImportMsg(null);
    try {
      const result = await importMut.mutateAsync({
        projectId,
        space: snapshotSpace.trim(),
        period,
      });
      setImportMsg(
        result.fetched === 0
          ? `No proposals on Snapshot for ${snapshotSpace.trim()} in ${period}.`
          : `Imported ${result.imported} new proposal${result.imported === 1 ? "" : "s"}${
              result.skipped > 0 ? `, skipped ${result.skipped} already imported` : ""
            }.`
      );
      // Persist the space on the project so next time it's pre-filled.
      const stored =
        (project as { snapshotSpace?: string | null } | undefined)
          ?.snapshotSpace ?? "";
      if (stored !== snapshotSpace.trim()) {
        updateProject.mutate({ id: projectId, snapshotSpace: snapshotSpace.trim() });
      }
    } catch (err) {
      setImportMsg(
        err instanceof Error ? err.message : "Import failed."
      );
    }
  }

  return (
    <>
      {/* Snapshot.org auto-import. Public GraphQL — no API key. Founder
          types the governance space ('ens.eth', 'uniswap', etc.), picks
          the period, and we pull all proposals created in that month. */}
      <div
        style={{
          display: "grid",
          gap: 8,
          padding: 12,
          marginBottom: 14,
          background: "var(--vb-alt)",
          border: "1px solid var(--vb-border)",
          borderRadius: 8,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--vb-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Auto-import from Snapshot.org
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr auto",
            gap: 8,
            alignItems: "end",
          }}
        >
          <div>
            <label style={labelStyle}>Snapshot space</label>
            <input
              style={inputStyle}
              value={snapshotSpace}
              onChange={(e) => setSnapshotSpace(e.target.value)}
              placeholder="e.g. ens.eth"
              aria-label="Snapshot space"
            />
          </div>
          <div>
            <label style={labelStyle}>Period</label>
            <input
              style={inputStyle}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="2026-04"
              aria-label="Period"
            />
          </div>
          <button
            type="button"
            style={submitStyle}
            disabled={
              !snapshotSpace.trim() ||
              !PERIOD_RE.test(period) ||
              importMut.isPending
            }
            onClick={importFromSnapshot}
          >
            <Download size={12} />
            {importMut.isPending ? "Importing…" : "Import"}
          </button>
        </div>
        {/* Hint when the button is disabled — placeholder alone reads
            like a filled value, so make the empty-state explicit. */}
        {!snapshotSpace.trim() && !importMsg && (
          <div
            style={{
              fontSize: 11,
              color: "var(--vb-dim)",
              fontStyle: "italic",
            }}
          >
            Type your DAO&apos;s Snapshot space slug to enable Import.
          </div>
        )}
        {importMsg && (
          <div
            style={{
              fontSize: 11,
              color: importMsg.startsWith("Imported")
                ? "#00e87b"
                : importMsg.startsWith("No proposals")
                  ? "var(--vb-muted)"
                  : "#f87171",
            }}
          >
            {importMsg}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        <div>
          <label style={labelStyle}>Proposal title</label>
          <input
            style={inputStyle}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="EP-12: Treasury rebalance to 60/40 stables"
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={labelStyle}>Status</label>
            <select
              style={inputStyle}
              value={status}
              onChange={(e) =>
                setStatus(
                  e.target.value as
                    | "submitted"
                    | "passed"
                    | "rejected"
                    | "active"
                )
              }
            >
              <option value="submitted">Submitted</option>
              <option value="active">Active vote</option>
              <option value="passed">Passed</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Period (YYYY-MM)</label>
            <input
              style={inputStyle}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label style={labelStyle}>URL (Snapshot/Tally, optional)</label>
          <input
            style={inputStyle}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://snapshot.org/#/...."
          />
        </div>
        <div>
          <label style={labelStyle}>Vote result (optional)</label>
          <input
            style={inputStyle}
            value={voteResult}
            onChange={(e) => setVoteResult(e.target.value)}
            placeholder="78% / 22% with 14M tokens voting"
          />
        </div>
        <div>
          <button
            type="button"
            style={submitStyle}
            disabled={!title || !PERIOD_RE.test(period) || add.isPending}
            onClick={submit}
          >
            <Plus size={12} /> {add.isPending ? "Adding…" : "Add proposal"}
          </button>
        </div>
      </div>

      <ItemList
        rows={list}
        empty="No proposals yet."
        render={(p) => (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: "var(--vb-text)", fontWeight: 600 }}>
                [{p.status}] {p.title}
              </div>
              <div style={{ fontSize: 11, color: "var(--vb-dim)", marginTop: 2 }}>
                {p.period}
                {p.voteResult ? ` · ${p.voteResult}` : ""}
              </div>
            </div>
            <RemoveBtn onClick={() => remove.mutate({ id: p.id })} />
          </>
        )}
      />
    </>
  );
}

// ─── Partners ──────────────────────────────────────────────────────────

function PartnersRenderer({ projectId }: { projectId: string }) {
  const { data: list = [], refetch } = trpc.partners.list.useQuery({
    projectId,
  });
  const add = trpc.partners.add.useMutation({ onSuccess: () => refetch() });
  const remove = trpc.partners.remove.useMutation({
    onSuccess: () => refetch(),
  });

  const [name, setName] = useState("");
  const [type, setType] = useState<
    "partnership" | "integration" | "listing" | "bridge" | "other"
  >("integration");
  const [url, setUrl] = useState("");
  const [period, setPeriod] = useState(defaultPeriod());

  function submit() {
    if (!name) return;
    add.mutate(
      {
        projectId,
        name,
        type,
        url: url || undefined,
        period,
      },
      {
        onSuccess: () => {
          setName("");
          setUrl("");
        },
      }
    );
  }

  return (
    <>
      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "1fr 1fr",
          marginBottom: 16,
        }}
      >
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Partner name</label>
          <input
            style={inputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Coinbase Custody"
          />
        </div>
        <div>
          <label style={labelStyle}>Type</label>
          <select
            style={inputStyle}
            value={type}
            onChange={(e) =>
              setType(
                e.target.value as
                  | "partnership"
                  | "integration"
                  | "listing"
                  | "bridge"
                  | "other"
              )
            }
          >
            <option value="partnership">Partnership</option>
            <option value="integration">Integration</option>
            <option value="listing">Listing</option>
            <option value="bridge">Bridge</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Period (YYYY-MM)</label>
          <input
            style={inputStyle}
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>URL (optional)</label>
          <input
            style={inputStyle}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <button
            type="button"
            style={submitStyle}
            disabled={!name || !PERIOD_RE.test(period) || add.isPending}
            onClick={submit}
          >
            <Plus size={12} /> {add.isPending ? "Adding…" : "Add partner"}
          </button>
        </div>
      </div>

      <ItemList
        rows={list}
        empty="No partners yet."
        render={(p) => (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: "var(--vb-text)", fontWeight: 600 }}>
                {p.name}
                {p.type ? ` (${p.type})` : ""}
              </div>
              <div style={{ fontSize: 11, color: "var(--vb-dim)", marginTop: 2 }}>
                {p.period}
              </div>
            </div>
            <RemoveBtn onClick={() => remove.mutate({ id: p.id })} />
          </>
        )}
      />
    </>
  );
}

// ─── Asks ──────────────────────────────────────────────────────────────

function AsksRenderer({ projectId }: { projectId: string }) {
  const { data: list = [], refetch } = trpc.asks.list.useQuery({ projectId });
  const add = trpc.asks.add.useMutation({ onSuccess: () => refetch() });
  const update = trpc.asks.update.useMutation({ onSuccess: () => refetch() });
  const remove = trpc.asks.remove.useMutation({ onSuccess: () => refetch() });

  const [request, setRequest] = useState("");
  const [category, setCategory] = useState<
    "intros" | "governance" | "hiring" | "other"
  >("intros");

  function submit() {
    if (!request) return;
    add.mutate(
      { projectId, request, category, status: "open" },
      { onSuccess: () => setRequest("") }
    );
  }

  return (
    <>
      <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        <div>
          <label style={labelStyle}>Ask</label>
          <input
            style={inputStyle}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="Intro to BD lead at any major DEX"
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
          <div>
            <label style={labelStyle}>Category</label>
            <select
              style={inputStyle}
              value={category}
              onChange={(e) =>
                setCategory(
                  e.target.value as "intros" | "governance" | "hiring" | "other"
                )
              }
            >
              <option value="intros">Intros</option>
              <option value="governance">Governance</option>
              <option value="hiring">Hiring</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              type="button"
              style={submitStyle}
              disabled={!request || add.isPending}
              onClick={submit}
            >
              <Plus size={12} /> {add.isPending ? "Adding…" : "Add ask"}
            </button>
          </div>
        </div>
      </div>

      <ItemList
        rows={list}
        empty="No asks yet."
        render={(a) => (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  color:
                    a.status === "resolved"
                      ? "var(--vb-dim)"
                      : "var(--vb-text)",
                  fontWeight: 600,
                  textDecoration:
                    a.status === "resolved" ? "line-through" : "none",
                }}
              >
                {a.request}
              </div>
              <div style={{ fontSize: 11, color: "var(--vb-dim)", marginTop: 2 }}>
                {a.category ?? "—"} · {a.status}
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                update.mutate({
                  id: a.id,
                  status: a.status === "open" ? "resolved" : "open",
                })
              }
              style={{
                background: "transparent",
                border: "1px solid var(--vb-border)",
                color: "var(--vb-muted)",
                borderRadius: 6,
                padding: "5px 10px",
                fontSize: 11,
                cursor: "pointer",
                fontFamily: "inherit",
                marginRight: 4,
              }}
            >
              {a.status === "open" ? "Mark resolved" : "Reopen"}
            </button>
            <RemoveBtn onClick={() => remove.mutate({ id: a.id })} />
          </>
        )}
      />
    </>
  );
}

// ─── Q&A ───────────────────────────────────────────────────────────────

function QaRenderer({ projectId }: { projectId: string }) {
  const { data: list = [], refetch } = trpc.qaHighlights.list.useQuery({
    projectId,
  });
  const add = trpc.qaHighlights.add.useMutation({ onSuccess: () => refetch() });
  const remove = trpc.qaHighlights.remove.useMutation({
    onSuccess: () => refetch(),
  });

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [askedBy, setAskedBy] = useState("");
  const [period, setPeriod] = useState(defaultPeriod());

  function submit() {
    if (!question || !answer) return;
    add.mutate(
      {
        projectId,
        question,
        answer,
        askedBy: askedBy || undefined,
        period,
        displayOrder: 0,
      },
      {
        onSuccess: () => {
          setQuestion("");
          setAnswer("");
          setAskedBy("");
        },
      }
    );
  }

  return (
    <>
      <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        <div>
          <label style={labelStyle}>Question</label>
          <input
            style={inputStyle}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Why the L2 push now?"
          />
        </div>
        <div>
          <label style={labelStyle}>Answer</label>
          <textarea
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Gas costs eat into smaller transactions and we want broader reach."
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={labelStyle}>Asked by (optional)</label>
            <input
              style={inputStyle}
              value={askedBy}
              onChange={(e) => setAskedBy(e.target.value)}
              placeholder="@frens"
            />
          </div>
          <div>
            <label style={labelStyle}>Period (YYYY-MM)</label>
            <input
              style={inputStyle}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          </div>
        </div>
        <div>
          <button
            type="button"
            style={submitStyle}
            disabled={
              !question || !answer || !PERIOD_RE.test(period) || add.isPending
            }
            onClick={submit}
          >
            <Plus size={12} /> {add.isPending ? "Adding…" : "Add Q&A"}
          </button>
        </div>
      </div>

      <ItemList
        rows={list}
        empty="No Q&A yet."
        render={(q) => (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: "var(--vb-text)", fontWeight: 600 }}>
                {q.question}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--vb-muted)",
                  marginTop: 4,
                  lineHeight: 1.5,
                }}
              >
                {q.answer}
              </div>
              <div style={{ fontSize: 11, color: "var(--vb-dim)", marginTop: 4 }}>
                {q.period}
                {q.askedBy ? ` · ${q.askedBy}` : ""}
              </div>
            </div>
            <RemoveBtn onClick={() => remove.mutate({ id: q.id })} />
          </>
        )}
      />
    </>
  );
}

// ─── Milestones ────────────────────────────────────────────────────────
// Backs both `milestones_completed` (status=completed within period) and
// `looking_ahead` (status in {planned,in_progress,delayed}). One editor,
// one table — status drives which report section the row lights up.

const MILESTONE_STATUSES = [
  "planned",
  "in_progress",
  "delayed",
  "completed",
] as const;
type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

const STATUS_LABELS: Record<MilestoneStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  delayed: "Delayed",
  completed: "Completed",
};

function MilestonesRenderer({ projectId }: { projectId: string }) {
  const { data: list = [], refetch } = trpc.milestones.list.useQuery({
    projectId,
  });
  const add = trpc.milestones.add.useMutation({ onSuccess: () => refetch() });
  const update = trpc.milestones.update.useMutation({
    onSuccess: () => refetch(),
  });
  const remove = trpc.milestones.remove.useMutation({
    onSuccess: () => refetch(),
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<MilestoneStatus>("in_progress");
  const [targetDate, setTargetDate] = useState("");
  const [completedDate, setCompletedDate] = useState("");

  // Inline edit-mode for an existing row. We don't open a separate modal —
  // the row's render swaps to a form when its id matches editingId.
  const [editingId, setEditingId] = useState<string | null>(null);

  // Three-way filter so projects with many completed milestones don't
  // bury the active ones. "all" is default — most projects have <10 rows.
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const visible = list.filter((m) => {
    if (filter === "all") return true;
    const isActive = m.status !== "completed";
    return filter === "active" ? isActive : !isActive;
  });

  function submit() {
    if (!title.trim()) return;
    add.mutate(
      {
        projectId,
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        targetDate: targetDate || undefined,
        completedDate:
          status === "completed" ? completedDate || undefined : undefined,
      },
      {
        onSuccess: () => {
          setTitle("");
          setDescription("");
          setTargetDate("");
          setCompletedDate("");
          setStatus("in_progress");
        },
      }
    );
  }

  return (
    <>
      <p
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 12,
          color: "var(--vb-dim)",
          margin: "0 0 14px",
          lineHeight: 1.5,
        }}
      >
        Active and planned milestones drive the &ldquo;Looking Ahead&rdquo;
        section. Completed ones surface in &ldquo;Milestones Completed&rdquo;
        for the period in which they were finished.
      </p>

      <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        <div>
          <label style={labelStyle}>Title</label>
          <input
            style={inputStyle}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Mainnet launch on Base"
          />
        </div>
        <div>
          <label style={labelStyle}>Description (optional)</label>
          <textarea
            rows={2}
            style={{ ...inputStyle, resize: "vertical", minHeight: 56 }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short context — what this means for the product or treasury."
          />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr auto",
            gap: 10,
          }}
        >
          <div>
            <label style={labelStyle}>Status</label>
            <select
              style={inputStyle}
              value={status}
              onChange={(e) => setStatus(e.target.value as MilestoneStatus)}
            >
              {MILESTONE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Target date</label>
            <input
              type="date"
              style={inputStyle}
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Completed</label>
            <input
              type="date"
              style={inputStyle}
              value={completedDate}
              disabled={status !== "completed"}
              onChange={(e) => setCompletedDate(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              type="button"
              style={submitStyle}
              disabled={!title.trim() || add.isPending}
              onClick={submit}
            >
              <Plus size={12} /> {add.isPending ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      </div>

      {list.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 4,
            marginBottom: 10,
            fontFamily: "var(--font-inter), Inter, sans-serif",
          }}
          role="tablist"
          aria-label="Filter milestones"
        >
          {(["all", "active", "completed"] as const).map((opt) => {
            const count =
              opt === "all"
                ? list.length
                : opt === "active"
                  ? list.filter((m) => m.status !== "completed").length
                  : list.filter((m) => m.status === "completed").length;
            const active = filter === opt;
            return (
              <button
                key={opt}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(opt)}
                style={{
                  background: active
                    ? "rgba(0,232,123,0.12)"
                    : "transparent",
                  border: `1px solid ${
                    active ? "rgba(0,232,123,0.4)" : "var(--vb-border)"
                  }`,
                  color: active ? "#00e87b" : "var(--vb-muted)",
                  borderRadius: 6,
                  padding: "5px 10px",
                  fontSize: 11,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textTransform: "capitalize",
                }}
              >
                {opt} <span style={{ opacity: 0.6 }}>· {count}</span>
              </button>
            );
          })}
        </div>
      )}

      <ItemList
        rows={visible}
        empty={
          list.length === 0
            ? "No milestones yet. Add one to fill Looking Ahead."
            : `No ${filter === "active" ? "active" : "completed"} milestones.`
        }
        render={(m) =>
          editingId === m.id ? (
            <MilestoneEditRow
              milestone={m}
              onCancel={() => setEditingId(null)}
              onSave={(patch) =>
                update.mutate(
                  { id: m.id, ...patch },
                  { onSuccess: () => setEditingId(null) }
                )
              }
              isSaving={update.isPending}
            />
          ) : (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--vb-text)",
                    fontWeight: 600,
                    textDecoration:
                      m.status === "completed" ? "line-through" : "none",
                  }}
                >
                  {m.title}
                </div>
                {m.description && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--vb-muted)",
                      marginTop: 2,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {m.description}
                  </div>
                )}
                <div
                  style={{ fontSize: 11, color: "var(--vb-dim)", marginTop: 2 }}
                >
                  {STATUS_LABELS[m.status as MilestoneStatus] ?? m.status}
                  {m.targetDate ? ` · target ${m.targetDate}` : ""}
                  {m.completedDate ? ` · completed ${m.completedDate}` : ""}
                </div>
              </div>
              <select
                value={m.status}
                onChange={(e) => {
                  const next = e.target.value as MilestoneStatus;
                  update.mutate({
                    id: m.id,
                    status: next,
                    // Auto-stamp completedDate the first time someone flips
                    // a row to completed. Editable via "Edit" if needed.
                    completedDate:
                      next === "completed" && !m.completedDate
                        ? new Date().toISOString().slice(0, 10)
                        : undefined,
                  });
                }}
                style={{
                  ...inputStyle,
                  width: "auto",
                  fontSize: 11,
                  padding: "5px 8px",
                  marginRight: 4,
                }}
                aria-label="Change milestone status"
              >
                {MILESTONE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setEditingId(m.id)}
                style={{
                  background: "transparent",
                  border: "1px solid var(--vb-border)",
                  color: "var(--vb-muted)",
                  borderRadius: 6,
                  padding: "5px 10px",
                  fontSize: 11,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  marginRight: 4,
                }}
              >
                Edit
              </button>
              <RemoveBtn onClick={() => remove.mutate({ id: m.id })} />
            </>
          )
        }
      />
    </>
  );
}

interface MilestoneRowShape {
  id: string;
  title: string;
  description: string | null;
  status: string;
  targetDate: string | null;
  completedDate: string | null;
}

interface MilestoneEditPatch {
  title?: string;
  description?: string | null;
  status?: MilestoneStatus;
  targetDate?: string | null;
  completedDate?: string | null;
}

function MilestoneEditRow({
  milestone,
  onCancel,
  onSave,
  isSaving,
}: {
  milestone: MilestoneRowShape;
  onCancel: () => void;
  onSave: (patch: MilestoneEditPatch) => void;
  isSaving: boolean;
}) {
  const [title, setTitle] = useState(milestone.title);
  const [description, setDescription] = useState(milestone.description ?? "");
  const [status, setStatus] = useState<MilestoneStatus>(
    (milestone.status as MilestoneStatus) ?? "planned"
  );
  const [targetDate, setTargetDate] = useState(milestone.targetDate ?? "");
  const [completedDate, setCompletedDate] = useState(
    milestone.completedDate ?? ""
  );

  function save() {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      description: description.trim() ? description.trim() : null,
      status,
      targetDate: targetDate || null,
      completedDate: status === "completed" ? completedDate || null : null,
    });
  }

  return (
    <div
      style={{
        flex: 1,
        display: "grid",
        gap: 8,
      }}
    >
      <input
        style={inputStyle}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        aria-label="Milestone title"
      />
      <textarea
        rows={2}
        style={{ ...inputStyle, resize: "vertical", minHeight: 56 }}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        aria-label="Milestone description"
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 8,
        }}
      >
        <select
          style={inputStyle}
          value={status}
          onChange={(e) => setStatus(e.target.value as MilestoneStatus)}
          aria-label="Milestone status"
        >
          {MILESTONE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <input
          type="date"
          style={inputStyle}
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          aria-label="Target date"
        />
        <input
          type="date"
          style={inputStyle}
          value={completedDate}
          disabled={status !== "completed"}
          onChange={(e) => setCompletedDate(e.target.value)}
          aria-label="Completed date"
        />
      </div>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          style={{
            background: "transparent",
            border: "1px solid var(--vb-border)",
            color: "var(--vb-muted)",
            borderRadius: 6,
            padding: "6px 12px",
            fontSize: 12,
            cursor: isSaving ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!title.trim() || isSaving}
          style={{
            ...submitStyle,
            padding: "6px 14px",
            fontSize: 12,
          }}
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ─── shared bits ───────────────────────────────────────────────────────

function ItemList<T extends { id: string }>({
  rows,
  empty,
  render,
}: {
  rows: T[];
  empty: string;
  render: (row: T) => React.ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <p
        style={{
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 12,
          color: "var(--vb-dim)",
          margin: 0,
          padding: "12px 0",
          textAlign: "center",
        }}
      >
        {empty}
      </p>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((r) => (
        <div
          key={r.id}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "10px 12px",
            background: "var(--vb-alt)",
            border: "1px solid var(--vb-border)",
            borderRadius: 8,
          }}
        >
          {render(r)}
        </div>
      ))}
    </div>
  );
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove"
      style={removeBtnStyle}
    >
      <Trash2 size={13} />
    </button>
  );
}
