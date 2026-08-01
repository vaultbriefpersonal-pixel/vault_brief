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
  // "Grants Distributed" is money this project GAVE OUT; the two grant titles
  // below are money a funder GAVE THIS PROJECT. The modal header is the only
  // label a founder sees once the modal is open, so it has to name the
  // direction on its own — "Grants" would be ambiguous in exactly the way the
  // schema header warns about.
  grants_distributed: "Grants Distributed (money you gave out)",
  governance_updates: "Governance Updates",
  partners_integrations: "Partners & Integrations",
  asks: "Asks",
  qa_highlights: "Q&A Highlights",
  milestones_completed: "Milestones",
  looking_ahead: "Milestones",
  grant_fund_usage: "Grant funding received (money awarded to you)",
  grant_milestone_progress: "Grant funding received (money awarded to you)",
  leftover_funds: "Grant funding received (money awarded to you)",
  plan_deviation: "Grant funding received (money awarded to you)",
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

// Sub-label prose under a field. Used where the field's BEHAVIOUR is not
// guessable from its name — a blank "Deviation from the plan" box does not
// look like it will print a sentence, and a founder who does not know that
// cannot make an informed decision to leave it blank.
const helpTextStyle: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.5,
  color: "var(--vb-dim)",
  margin: "5px 0 0",
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

const ghostBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--vb-border)",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 11,
  color: "var(--vb-muted)",
  fontFamily: "var(--font-inter), Inter, sans-serif",
  cursor: "pointer",
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
          {/* ONE renderer for both grant sections, not two. They read one
              dataset: an award, its tranches, and the milestones attached to
              it. An award has to exist before a tranche or a deliverable can
              hang off it, so the entry order is fixed either way — two
              renderers would be this same form with half of it hidden, and
              the founder who opened the deliverables section first would find
              no way to create the award the attachment needs. */}
          {(sectionId === "grant_fund_usage" ||
            sectionId === "grant_milestone_progress" ||
            sectionId === "leftover_funds" ||
            sectionId === "plan_deviation") && (
            <GrantAwardsRenderer projectId={projectId} />
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
  const [sourceOfTruth, setSourceOfTruth] = useState("");

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
        sourceOfTruth: sourceOfTruth.trim() || undefined,
      },
      {
        onSuccess: () => {
          setRecipient("");
          setAmountUsd("");
          setCategory("");
          setNotes("");
          setSourceOfTruth("");
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
          <label style={labelStyle}>Source of Truth (optional)</label>
          <input
            style={inputStyle}
            value={sourceOfTruth}
            onChange={(e) => setSourceOfTruth(e.target.value)}
            placeholder="Tx hash, explorer link, or the proposal that authorised it"
          />
          <p style={helpTextStyle}>
            The pointer a reader can check. The money left the treasury, so a
            transaction hash usually exists — that is the strongest answer here.
          </p>
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

// ─── Grant funding RECEIVED ────────────────────────────────────────────
//
// ⚠️ The mirror of GrantsRenderer directly above, and the opposite direction.
// That one writes the `grants` table: money this project GIVES OUT, with a
// `recipient`. This one writes `grant_awards` / `grant_tranches`: money a
// funder GAVE THIS PROJECT, with a `grantor`. Copy its shape, never its
// labels — "Recipient" and "Grantor" are opposite ends of the same transfer,
// and a form that borrowed the wrong word would have founders filing their
// Optimism award as a grant they made to Optimism.

const AWARD_STATUSES = ["active", "completed", "terminated"] as const;
type AwardStatus = (typeof AWARD_STATUSES)[number];

const AWARD_STATUS_LABELS: Record<AwardStatus, string> = {
  active: "Active — reporting ongoing",
  completed: "Completed — work delivered",
  terminated: "Terminated",
};

// Must stay in step with REPORTING_CADENCES in trpc/routers/grant-awards.ts —
// that Zod enum is the enforcing copy (the column itself is plain TEXT), so a
// value added here and not there is rejected at submit.
const AWARD_CADENCES = [
  "monthly",
  "quarterly",
  "milestone_based",
  "ad_hoc",
] as const;
type AwardCadence = (typeof AWARD_CADENCES)[number];

const AWARD_CADENCE_LABELS: Record<AwardCadence, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  milestone_based: "On each milestone",
  ad_hoc: "Ad hoc — no fixed schedule",
};

interface AwardFormValues {
  grantor: string;
  program: string;
  awardDate: string;
  status: AwardStatus;
  awardAmountUsd: string;
  awardAmountToken: string;
  awardTokenSymbol: string;
  // "" = the agreement states no cadence, which the column stores as NULL.
  reportingCadence: AwardCadence | "";
  nextReportDue: string;
  amountUsdAtReceipt: string;
  leftoverFundsPlan: string;
  planDeviation: string;
  agreementUrl: string;
  notes: string;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function emptyAward(): AwardFormValues {
  return {
    grantor: "",
    program: "",
    awardDate: todayIso(),
    status: "active",
    awardAmountUsd: "",
    awardAmountToken: "",
    awardTokenSymbol: "",
    reportingCadence: "",
    nextReportDue: "",
    amountUsdAtReceipt: "",
    // Both blank. `planDeviation` blank is NOT "no answer" — the report
    // supplies the standing "No changes to the original plan." sentence, which
    // is the whole point of that block. See the column comment in schema.ts.
    leftoverFundsPlan: "",
    planDeviation: "",
    agreementUrl: "",
    notes: "",
  };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const URL_RE = /^https?:\/\/\S+$/;

/**
 * A blank amount field means "the agreement does not state this figure", which
 * the column models as NULL and the report prints as "not recorded". It must
 * never become 0 — "Awarded: $0" is a false statement about a real grant.
 */
function blankOrNumber(raw: string): { ok: boolean; value: number | null } {
  const t = raw.trim();
  if (!t) return { ok: true, value: null };
  const n = Number(t);
  return { ok: Number.isFinite(n) && n >= 0, value: n };
}

function awardFormErrors(v: AwardFormValues): string[] {
  const errors: string[] = [];
  if (!v.grantor.trim()) errors.push("Grantor is required.");
  if (!ISO_DATE_RE.test(v.awardDate)) errors.push("Award date must be YYYY-MM-DD.");
  if (!blankOrNumber(v.awardAmountUsd).ok) {
    errors.push("USD amount must be a non-negative number, or blank.");
  }
  const token = blankOrNumber(v.awardAmountToken);
  if (!token.ok) {
    errors.push("Token amount must be a non-negative number, or blank.");
  }
  if (token.value !== null && !v.awardTokenSymbol.trim()) {
    errors.push("A token amount needs its token symbol.");
  }
  if (!blankOrNumber(v.amountUsdAtReceipt).ok) {
    errors.push("USD value at receipt must be a non-negative number, or blank.");
  }
  if (v.nextReportDue && !ISO_DATE_RE.test(v.nextReportDue)) {
    errors.push("Next report due must be YYYY-MM-DD.");
  }
  if (v.agreementUrl.trim() && !URL_RE.test(v.agreementUrl.trim())) {
    errors.push("Agreement link must start with http:// or https://.");
  }
  return errors;
}

/** Shared by the create form and the per-award edit form. */
function AwardFields({
  values,
  onChange,
}: {
  values: AwardFormValues;
  onChange: (next: AwardFormValues) => void;
}) {
  const set = (patch: Partial<AwardFormValues>) =>
    onChange({ ...values, ...patch });
  return (
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
      <div>
        <label style={labelStyle}>Grantor (who awarded it)</label>
        <input
          style={inputStyle}
          value={values.grantor}
          onChange={(e) => set({ grantor: e.target.value })}
          placeholder="Optimism Foundation"
        />
      </div>
      <div>
        <label style={labelStyle}>Program (optional)</label>
        <input
          style={inputStyle}
          value={values.program}
          onChange={(e) => set({ program: e.target.value })}
          placeholder="RetroPGF Round 4"
        />
      </div>
      <div>
        <label style={labelStyle}>Award date</label>
        <input
          type="date"
          style={inputStyle}
          value={values.awardDate}
          onChange={(e) => set({ awardDate: e.target.value })}
        />
      </div>
      <div>
        <label style={labelStyle}>Status</label>
        <select
          style={inputStyle}
          value={values.status}
          onChange={(e) => set({ status: e.target.value as AwardStatus })}
        >
          {AWARD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {AWARD_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Award amount (USD)</label>
        <input
          style={inputStyle}
          type="number"
          min="0"
          value={values.awardAmountUsd}
          onChange={(e) => set({ awardAmountUsd: e.target.value })}
          placeholder="Leave blank if not in USD"
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
        <div>
          <label style={labelStyle}>Award amount (tokens)</label>
          <input
            style={inputStyle}
            type="number"
            min="0"
            value={values.awardAmountToken}
            onChange={(e) => set({ awardAmountToken: e.target.value })}
            placeholder="30000000"
          />
        </div>
        <div>
          <label style={labelStyle}>Symbol</label>
          <input
            style={inputStyle}
            value={values.awardTokenSymbol}
            onChange={(e) => set({ awardTokenSymbol: e.target.value })}
            placeholder="OP"
          />
        </div>
      </div>
      <div>
        {/* Deliberately NOT the same field as "Award amount (USD)" above. That
            one is what the agreement says; this one is what the money was
            worth on the day it arrived, which for a token grant is a different
            number. Leaving it blank is correct for a plain USD grant. */}
        <label style={labelStyle}>USD value at receipt (optional)</label>
        <input
          style={inputStyle}
          type="number"
          min="0"
          value={values.amountUsdAtReceipt}
          onChange={(e) => set({ amountUsdAtReceipt: e.target.value })}
          placeholder="What the tokens were worth on arrival"
        />
      </div>
      <div>
        <label style={labelStyle}>Reporting cadence (optional)</label>
        <select
          style={inputStyle}
          value={values.reportingCadence}
          onChange={(e) =>
            set({ reportingCadence: e.target.value as AwardCadence | "" })
          }
        >
          <option value="">Not stated</option>
          {AWARD_CADENCES.map((c) => (
            <option key={c} value={c}>
              {AWARD_CADENCE_LABELS[c]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Next report due (optional)</label>
        <input
          type="date"
          style={inputStyle}
          value={values.nextReportDue}
          onChange={(e) => set({ nextReportDue: e.target.value })}
        />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label style={labelStyle}>
          Plan for leftover funds (optional)
        </label>
        <textarea
          rows={2}
          style={{ ...inputStyle, resize: "vertical" }}
          value={values.leftoverFundsPlan}
          onChange={(e) => set({ leftoverFundsPlan: e.target.value })}
          placeholder="What happens to grant money you have received and not used yet"
        />
        <p style={helpTextStyle}>
          The report works out <em>how much</em> is left from the tranche
          amounts you record below. It cannot work out what you intend to do
          with it, and that is the part grant programs ask for.
        </p>
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label style={labelStyle}>
          Deviation from the original plan (this period)
        </label>
        <textarea
          rows={2}
          style={{ ...inputStyle, resize: "vertical" }}
          value={values.planDeviation}
          onChange={(e) => set({ planDeviation: e.target.value })}
          placeholder="How the work departed from the plan the grant was awarded against"
        />
        <p style={helpTextStyle}>
          Leave blank and the report states{" "}
          <strong style={{ color: "var(--vb-text)" }}>
            &ldquo;No changes to the original plan.&rdquo;
          </strong>{" "}
          It is never silently omitted — an unanswered question and an unchanged
          plan look identical to a funder, so the report always answers.
        </p>
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label style={labelStyle}>Agreement link (optional)</label>
        <input
          style={inputStyle}
          value={values.agreementUrl}
          onChange={(e) => set({ agreementUrl: e.target.value })}
          placeholder="https://..."
        />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label style={labelStyle}>Notes (optional)</label>
        <input
          style={inputStyle}
          value={values.notes}
          onChange={(e) => set({ notes: e.target.value })}
          placeholder="Reporting due 30 days after each quarter"
        />
      </div>
    </div>
  );
}

function FormErrors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul
      style={{
        margin: "8px 0 0",
        paddingLeft: 18,
        fontSize: 11,
        color: "#f0b847",
        lineHeight: 1.6,
      }}
    >
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}

function GrantAwardsRenderer({ projectId }: { projectId: string }) {
  const { data: awards = [], refetch } = trpc.grantAwards.list.useQuery({
    projectId,
  });
  const createAward = trpc.grantAwards.createAward.useMutation({
    onSuccess: () => refetch(),
  });

  const [form, setForm] = useState<AwardFormValues>(emptyAward());
  const [showForm, setShowForm] = useState(false);
  const errors = awardFormErrors(form);

  function submit() {
    if (errors.length > 0) return;
    const usd = blankOrNumber(form.awardAmountUsd).value;
    const token = blankOrNumber(form.awardAmountToken).value;
    createAward.mutate(
      {
        projectId,
        grantor: form.grantor.trim(),
        program: form.program.trim() || null,
        awardAmountUsd: usd,
        awardAmountToken: token,
        awardTokenSymbol: token === null ? null : form.awardTokenSymbol.trim(),
        amountUsdAtReceipt: blankOrNumber(form.amountUsdAtReceipt).value,
        awardDate: form.awardDate,
        reportingCadence: form.reportingCadence || null,
        nextReportDue: form.nextReportDue || null,
        status: form.status,
        leftoverFundsPlan: form.leftoverFundsPlan.trim() || null,
        planDeviation: form.planDeviation.trim() || null,
        agreementUrl: form.agreementUrl.trim() || null,
        notes: form.notes.trim() || null,
      },
      {
        onSuccess: () => {
          setForm(emptyAward());
          setShowForm(false);
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
        Grants your project{" "}
        <strong style={{ color: "var(--vb-text)" }}>received</strong> — an
        ecosystem or foundation award you report back on. This is not the
        &ldquo;Grants Distributed&rdquo; section, which records grants you{" "}
        <em>make to others</em>.
        <br />
        Leave the USD amount blank for a token-denominated award: the report
        quotes the token figure rather than inventing a dollar value the
        agreement never stated.
      </p>

      {showForm ? (
        <div style={{ marginBottom: 16 }}>
          <AwardFields values={form} onChange={setForm} />
          <FormErrors errors={errors} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              type="button"
              style={submitStyle}
              disabled={errors.length > 0 || createAward.isPending}
              onClick={submit}
            >
              <Plus size={12} />{" "}
              {createAward.isPending ? "Saving…" : "Save award"}
            </button>
            <button
              type="button"
              style={ghostBtnStyle}
              onClick={() => {
                setForm(emptyAward());
                setShowForm(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          style={{ ...submitStyle, marginBottom: 16 }}
          onClick={() => setShowForm(true)}
        >
          <Plus size={12} /> Add a grant you received
        </button>
      )}

      {awards.length === 0 ? (
        <p
          style={{
            fontSize: 12,
            color: "var(--vb-dim)",
            margin: 0,
            padding: "12px 0",
            textAlign: "center",
          }}
        >
          No grant awards recorded yet.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {awards.map((award) => (
            <AwardCard
              key={award.id}
              projectId={projectId}
              award={award}
              onChanged={refetch}
            />
          ))}
        </div>
      )}
    </>
  );
}

type AwardRow = {
  id: string;
  grantor: string;
  program: string | null;
  status: string;
  awardDate: string;
  awardAmountUsd: string | null;
  awardAmountToken: string | null;
  awardTokenSymbol: string | null;
  amountUsdAtReceipt: string | null;
  leftoverFundsPlan: string | null;
  planDeviation: string | null;
  reportingCadence: string | null;
  nextReportDue: string | null;
  agreementUrl: string | null;
  notes: string | null;
  tranches: {
    id: string;
    label: string;
    amountUsd: string;
    expectedDate: string | null;
    receivedDate: string | null;
    utilizedUsd: string | null;
    txHash: string | null;
    sourceOfTruth: string | null;
  }[];
};

function AwardCard({
  projectId,
  award,
  onChanged,
}: {
  projectId: string;
  award: AwardRow;
  onChanged: () => void;
}) {
  const updateAward = trpc.grantAwards.updateAward.useMutation({
    onSuccess: () => onChanged(),
  });
  const removeAward = trpc.grantAwards.removeAward.useMutation({
    onSuccess: () => onChanged(),
  });
  const createTranche = trpc.grantAwards.createTranche.useMutation({
    onSuccess: () => onChanged(),
  });
  const removeTranche = trpc.grantAwards.removeTranche.useMutation({
    onSuccess: () => onChanged(),
  });

  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<AwardFormValues>(() => ({
    grantor: award.grantor,
    program: award.program ?? "",
    awardDate: String(award.awardDate),
    status: (AWARD_STATUSES as readonly string[]).includes(award.status)
      ? (award.status as AwardStatus)
      : "active",
    awardAmountUsd: award.awardAmountUsd == null ? "" : String(Number(award.awardAmountUsd)),
    awardAmountToken:
      award.awardAmountToken == null ? "" : String(Number(award.awardAmountToken)),
    awardTokenSymbol: award.awardTokenSymbol ?? "",
    amountUsdAtReceipt:
      award.amountUsdAtReceipt == null
        ? ""
        : String(Number(award.amountUsdAtReceipt)),
    // An unrecognised stored cadence falls back to "Not stated" rather than
    // silently rewriting itself to the first option in the list.
    reportingCadence: (AWARD_CADENCES as readonly string[]).includes(
      award.reportingCadence ?? ""
    )
      ? (award.reportingCadence as AwardCadence)
      : "",
    nextReportDue: award.nextReportDue ? String(award.nextReportDue) : "",
    leftoverFundsPlan: award.leftoverFundsPlan ?? "",
    planDeviation: award.planDeviation ?? "",
    agreementUrl: award.agreementUrl ?? "",
    notes: award.notes ?? "",
  }));
  const editErrors = awardFormErrors(edit);

  const [label, setLabel] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [receivedDate, setReceivedDate] = useState("");
  const [utilizedUsd, setUtilizedUsd] = useState("");
  const [sourceOfTruth, setSourceOfTruth] = useState("");

  const trancheAmount = Number(amountUsd);
  // Blank utilisation is VALID and means "not recorded" — never zero. It is
  // the state every tranche starts in, and the Leftover Grant Funds section
  // reports it as unreported rather than treating the whole receipt as
  // leftover. See the column comment on grantTranches.utilizedUsd.
  const trancheUtilized = blankOrNumber(utilizedUsd);
  const trancheValid =
    label.trim().length > 0 &&
    amountUsd.trim().length > 0 &&
    Number.isFinite(trancheAmount) &&
    trancheAmount >= 0 &&
    trancheUtilized.ok &&
    (!expectedDate || ISO_DATE_RE.test(expectedDate)) &&
    (!receivedDate || ISO_DATE_RE.test(receivedDate));

  const received = award.tranches
    .filter((t) => t.receivedDate)
    .reduce((sum, t) => sum + Number(t.amountUsd), 0);

  function saveEdit() {
    if (editErrors.length > 0) return;
    const token = blankOrNumber(edit.awardAmountToken).value;
    updateAward.mutate(
      {
        id: award.id,
        grantor: edit.grantor.trim(),
        program: edit.program.trim() || null,
        // Explicit null, not undefined: blanking the field in this form means
        // "the agreement states no such figure", and the router reads
        // undefined as "leave the stored value alone" — so undefined here
        // would make the amount impossible to clear once entered.
        awardAmountUsd: blankOrNumber(edit.awardAmountUsd).value,
        awardAmountToken: token,
        awardTokenSymbol: token === null ? null : edit.awardTokenSymbol.trim(),
        amountUsdAtReceipt: blankOrNumber(edit.amountUsdAtReceipt).value,
        awardDate: edit.awardDate,
        // Explicit null for the same reason as the amounts above: clearing the
        // dropdown means "no cadence stated", and undefined would leave the
        // stored value in place, making it impossible to unset.
        reportingCadence: edit.reportingCadence || null,
        nextReportDue: edit.nextReportDue || null,
        status: edit.status,
        // Explicit null, like the amounts above: clearing the box must be able
        // to clear the stored value. For planDeviation that returns the award
        // to the standing "No changes to the original plan." statement rather
        // than to silence.
        leftoverFundsPlan: edit.leftoverFundsPlan.trim() || null,
        planDeviation: edit.planDeviation.trim() || null,
        agreementUrl: edit.agreementUrl.trim() || null,
        notes: edit.notes.trim() || null,
      },
      { onSuccess: () => setEditing(false) }
    );
  }

  function addTranche() {
    if (!trancheValid) return;
    createTranche.mutate(
      {
        grantAwardId: award.id,
        label: label.trim(),
        amountUsd: trancheAmount,
        expectedDate: expectedDate || null,
        receivedDate: receivedDate || null,
        utilizedUsd: trancheUtilized.value,
        sourceOfTruth: sourceOfTruth.trim() || null,
      },
      {
        onSuccess: () => {
          setLabel("");
          setAmountUsd("");
          setExpectedDate("");
          setReceivedDate("");
          setUtilizedUsd("");
          setSourceOfTruth("");
        },
      }
    );
  }

  return (
    <div
      style={{
        border: "1px solid var(--vb-border)",
        borderRadius: 8,
        background: "var(--vb-alt)",
        padding: 12,
      }}
    >
      {editing ? (
        <>
          <AwardFields values={edit} onChange={setEdit} />
          <FormErrors errors={editErrors} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              type="button"
              style={submitStyle}
              disabled={editErrors.length > 0 || updateAward.isPending}
              onClick={saveEdit}
            >
              {updateAward.isPending ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              style={ghostBtnStyle}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{ fontSize: 13, color: "var(--vb-text)", fontWeight: 600 }}
            >
              {award.grantor}
              {award.program ? ` — ${award.program}` : ""}
            </div>
            <div style={{ fontSize: 11, color: "var(--vb-dim)", marginTop: 2 }}>
              {award.status} · awarded {String(award.awardDate)} ·{" "}
              {award.awardAmountUsd != null
                ? `$${Number(award.awardAmountUsd).toLocaleString()} awarded`
                : award.awardAmountToken != null
                  ? `${Number(award.awardAmountToken).toLocaleString()} ${
                      award.awardTokenSymbol ?? "tokens"
                    } awarded (no USD figure)`
                  : "award amount not recorded"}{" "}
              · ${received.toLocaleString()} received to date
              {award.amountUsdAtReceipt != null
                ? ` · $${Number(
                    award.amountUsdAtReceipt
                  ).toLocaleString()} value at receipt`
                : ""}
              {award.nextReportDue
                ? ` · next report due ${String(award.nextReportDue)}`
                : ""}
            </div>
          </div>
          <button
            type="button"
            style={ghostBtnStyle}
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          <RemoveBtn onClick={() => removeAward.mutate({ id: award.id })} />
        </div>
      )}

      {/* Tranches — the disbursement schedule. "Received" is what the report
          sums for "received to date"; leaving it blank is what marks a
          tranche as still owed, so it is deliberately not defaulted. */}
      <div style={{ marginTop: 12 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--vb-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 6,
          }}
        >
          Disbursement tranches
        </div>
        {award.tranches.length === 0 ? (
          <p style={{ fontSize: 11, color: "var(--vb-dim)", margin: "0 0 8px" }}>
            None recorded. Add each payment the agreement schedules.
          </p>
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}
          >
            {award.tranches.map((t) => (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: "var(--vb-text)",
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  {t.label} — ${Number(t.amountUsd).toLocaleString()}
                  <span style={{ color: "var(--vb-dim)" }}>
                    {t.expectedDate ? ` · expected ${t.expectedDate}` : ""}
                    {t.receivedDate
                      ? ` · received ${t.receivedDate}`
                      : " · not yet received"}
                    {t.utilizedUsd != null
                      ? ` · $${Number(t.utilizedUsd).toLocaleString()} utilised`
                      : " · utilisation not recorded"}
                    {t.sourceOfTruth ?? t.txHash
                      ? ` · source: ${t.sourceOfTruth ?? t.txHash}`
                      : ""}
                  </span>
                </span>
                <RemoveBtn onClick={() => removeTranche.mutate({ id: t.id })} />
              </div>
            ))}
          </div>
        )}

        <div
          style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 8 }}
        >
          <div>
            <label style={labelStyle}>Tranche label</label>
            <input
              style={inputStyle}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Tranche 1 — on signature"
            />
          </div>
          <div>
            <label style={labelStyle}>Amount (USD)</label>
            <input
              style={inputStyle}
              type="number"
              min="0"
              value={amountUsd}
              onChange={(e) => setAmountUsd(e.target.value)}
              placeholder="250000"
            />
          </div>
          <div>
            <label style={labelStyle}>Expected</label>
            <input
              type="date"
              style={inputStyle}
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Received</label>
            <input
              type="date"
              style={inputStyle}
              value={receivedDate}
              onChange={(e) => setReceivedDate(e.target.value)}
            />
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 2fr",
            gap: 8,
            marginTop: 8,
          }}
        >
          <div>
            <label style={labelStyle}>Utilised so far (USD)</label>
            <input
              style={inputStyle}
              type="number"
              min="0"
              value={utilizedUsd}
              onChange={(e) => setUtilizedUsd(e.target.value)}
              placeholder="Leave blank if not yet reported"
            />
          </div>
          <div>
            <label style={labelStyle}>Source of Truth</label>
            <input
              style={inputStyle}
              value={sourceOfTruth}
              onChange={(e) => setSourceOfTruth(e.target.value)}
              placeholder="0xabc… , an explorer link, or a dashboard URL"
            />
          </div>
        </div>
        <p style={helpTextStyle}>
          <strong style={{ color: "var(--vb-text)" }}>Utilised</strong> is what
          you have spent <em>of this tranche</em>, entered by hand. It is not
          read from your treasury: treasury money is fungible, so no balance can
          say which dollars came from this grant. Blank means &ldquo;not
          reported&rdquo;, which the report says plainly — it never reads blank
          as zero.
        </p>
        <button
          type="button"
          style={{ ...submitStyle, marginTop: 8 }}
          disabled={!trancheValid || createTranche.isPending}
          onClick={addTranche}
        >
          <Plus size={12} />{" "}
          {createTranche.isPending ? "Adding…" : "Add tranche"}
        </button>
      </div>

      <AwardDeliverables projectId={projectId} awardId={award.id} />
    </div>
  );
}

/**
 * Attaching milestones to the award.
 *
 * Without this the `grant_milestone_progress` section could never become
 * ready: `milestones.grant_award_id` has no other writer in the product, so
 * the section would ship permanently empty — the same dead-end the grant
 * renderer itself was blocked on until the sections existed.
 *
 * Milestones themselves are created in the Milestones modal; this only
 * attaches and detaches, so there is one place a milestone is authored.
 */
function AwardDeliverables({
  projectId,
  awardId,
}: {
  projectId: string;
  awardId: string;
}) {
  const { data: milestones = [], refetch } = trpc.milestones.list.useQuery({
    projectId,
  });
  const update = trpc.milestones.update.useMutation({
    onSuccess: () => refetch(),
  });
  const [pick, setPick] = useState("");

  const attached = milestones.filter(
    (m) => (m as { grantAwardId?: string | null }).grantAwardId === awardId
  );
  const available = milestones.filter(
    (m) => (m as { grantAwardId?: string | null }).grantAwardId == null
  );

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--vb-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 6,
        }}
      >
        Deliverables committed under this award
      </div>
      {attached.length === 0 ? (
        <p style={{ fontSize: 11, color: "var(--vb-dim)", margin: "0 0 8px" }}>
          None attached. Add milestones in the Milestones section first, then
          attach them here.
        </p>
      ) : (
        <div
          style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}
        >
          {attached.map((m) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                color: "var(--vb-text)",
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                [{m.status}] {m.title}
                <span style={{ color: "var(--vb-dim)" }}>
                  {m.targetDate ? ` · target ${m.targetDate}` : ""}
                  {m.completedDate ? ` · completed ${m.completedDate}` : ""}
                </span>
              </span>
              <button
                type="button"
                style={ghostBtnStyle}
                onClick={() =>
                  update.mutate({ id: m.id, grantAwardId: null })
                }
              >
                Detach
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Attach an existing milestone</label>
          <select
            style={inputStyle}
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          >
            <option value="">
              {available.length === 0
                ? "No unattached milestones"
                : "Choose a milestone…"}
            </option>
            {available.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          style={submitStyle}
          disabled={!pick || update.isPending}
          onClick={() =>
            update.mutate(
              { id: pick, grantAwardId: awardId },
              { onSuccess: () => setPick("") }
            )
          }
        >
          Attach
        </button>
      </div>
    </div>
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
  const [sourceOfTruth, setSourceOfTruth] = useState("");

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
        sourceOfTruth: sourceOfTruth.trim() || undefined,
      },
      {
        onSuccess: () => {
          setTitle("");
          setDescription("");
          setTargetDate("");
          setCompletedDate("");
          setStatus("in_progress");
          setSourceOfTruth("");
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
        <div>
          <label style={labelStyle}>Source of Truth (optional)</label>
          <input
            style={inputStyle}
            value={sourceOfTruth}
            onChange={(e) => setSourceOfTruth(e.target.value)}
            placeholder="PR link, tx hash, dashboard URL, or address"
          />
          <p style={helpTextStyle}>
            The pointer a reader can check for themselves. Shown beside this
            milestone in grant deliverable reporting; left blank, the row simply
            renders without one.
          </p>
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
