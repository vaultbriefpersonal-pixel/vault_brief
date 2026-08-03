"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Lock, RefreshCw, Sparkles } from "lucide-react";
import { trpc } from "@/lib/api";
import {
  buildPeriodOptions,
  resolvePeriodOption,
  type PeriodOption,
  type PeriodGrantAward,
  type PeriodSnapshotChoice,
} from "@/server/services/report-period-options";
import { periodFromRange } from "@/server/services/report-period";

/**
 * Choose the period a report covers, then generate it.
 *
 * WHAT THE FOUNDER IS ACTUALLY CHOOSING. Not a label — a snapshot. A report's
 * balances are as of its snapshot's end and its flows are measured over its
 * snapshot's window, so picking a period is picking the snapshot that covers
 * exactly that window. Options with no such snapshot are never snapped to a
 * nearby snapshot and never generated anyway; `buildPeriodOptions` owns that
 * decision and explains it at length. The server enforces the same rule
 * independently — `reports.generate` refuses a period that is not its
 * snapshot's own — so this component is the explanation, not the gate.
 *
 * ── THREE STATES, NOT TWO ──
 *
 * An option with no snapshot is not automatically dead. `buildPeriodOptions`
 * now returns a `createAction` for every window a sync could still produce, so:
 *
 *   • snapshotId set          → Generate.
 *   • createAction set        → selectable, and the primary button becomes
 *                               "Sync this period", which creates the snapshot.
 *   • neither                 → genuinely unavailable, dimmed, reason visible.
 *
 * THE RULE FOR WHICH IS WHICH IS NOT DUPLICATED HERE. It lives in
 * `resolvePeriodOption` → `assertCustomSyncWindow`, the same predicate
 * `projects.sync` validates against, so this component can never offer a sync
 * the mutation would refuse.
 *
 * The disabled-with-reason treatment follows `SyncNowButton`'s idiom (dim
 * label, `not-allowed`, reason on the control) with the reason ALSO rendered as
 * visible text: a tooltip is not a disclosure a founder can be assumed to have
 * read, and here the reason is usually an instruction.
 *
 * Balance provenance gets a full banner rather than a footnote, and it renders
 * BEFORE the generate button rather than in the finished report. A
 * reconstructed balance is a derived estimate with a documented floor —
 * clamped positions, unpriced tokens, gas understated — and a founder about to
 * send it to a funder has to see that while they can still choose otherwise.
 */
interface Props {
  projectId: string;
  snapshots: PeriodSnapshotChoice[];
  grantAwards: PeriodGrantAward[];
  /** `max(reports.period_end)`, or null. */
  lastReportPeriodEnd: string | null;
  /**
   * Today as a UTC day, resolved on the SERVER. Deriving it in the browser
   * instead would let a client in a different timezone build a different option
   * list than the one that was server-rendered.
   */
  today: string;
}

const CUSTOM_ID = "custom";

export function ReportPeriodPicker({
  projectId,
  snapshots,
  grantAwards,
  lastReportPeriodEnd,
  today,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // Null until the founder picks, so the default can be "the first period that
  // actually works" rather than a hard-coded id that may itself be unavailable
  // (a project with no snapshots has no latest period to offer).
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  // Both default to unselected/None — leaving them untouched must reproduce
  // today's single-click generate flow byte-for-byte, so `generate.mutate`
  // below only adds `grantId`/`presetId` when one of these is non-empty.
  const [selectedGrantId, setSelectedGrantId] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");

  // Fetched fresh here rather than threaded down as a prop: this is the only
  // consumer, and `presets.list` is a cheap system+own-project query.
  const presetsQ = trpc.presets.list.useQuery({ projectId });

  const options = useMemo(
    () =>
      buildPeriodOptions({
        snapshots,
        grantAwards,
        lastReportPeriodEnd,
        today,
      }),
    [snapshots, grantAwards, lastReportPeriodEnd, today]
  );

  // The custom window is resolved through the SAME function the presets go
  // through, so a hand-typed range is judged by identical rules — including the
  // reconstruction horizon and the exact-coverage requirement.
  const customOption = useMemo<PeriodOption | null>(() => {
    if (!customStart || !customEnd) return null;
    let period;
    try {
      period = periodFromRange(customStart, customEnd);
    } catch (err) {
      return {
        id: CUSTOM_ID,
        label: "Custom period",
        hint: "",
        period: null,
        snapshotId: null,
        basis: null,
        reconstruction: null,
        disabledReason:
          err instanceof Error ? err.message : "That is not a valid date range.",
        createAction: null,
      };
    }
    return {
      id: CUSTOM_ID,
      label: `Custom period — ${period.label}`,
      hint: `From ${period.start} to ${period.end} (${period.days} days)`,
      ...resolvePeriodOption(period, snapshots, today),
    };
  }, [customStart, customEnd, snapshots, today]);

  const selectedId =
    pickedId ??
    options.find((o) => o.disabledReason === null && o.id !== CUSTOM_ID)?.id ??
    options[0]?.id ??
    CUSTOM_ID;

  const selected =
    selectedId === CUSTOM_ID
      ? customOption
      : (options.find((o) => o.id === selectedId) ?? null);

  const canGenerate = trpc.reports.canGenerate.useQuery({ projectId });

  const generate = trpc.reports.generate.useMutation({
    onSuccess: (report) => {
      router.refresh();
      router.push(`/projects/${projectId}/reports/${report.id}`);
    },
    onError: (err) => setError(err.message || "Failed to generate report"),
  });

  const sync = trpc.projects.sync.useMutation({
    onSuccess: (res) => {
      // `errors` carries the per-period refusals, and the one that matters here
      // is `snapshotPeriodConflicts`: a snapshot already exists at this window's
      // end date describing a DIFFERENT period, and overwriting it would
      // silently change the data under an existing report. The message explains
      // exactly that, so it is shown VERBATIM rather than counted — "1 period
      // failed" would be indistinguishable from a network problem.
      const first = res.errors?.[0];
      if (first) {
        setError(first.error);
        return;
      }
      router.refresh();
      // `projects.sync` generates the report for the newest period it wrote (or
      // returns the one that already covers it). Landing on that report is both
      // what the founder wanted and what stops them generating a duplicate for
      // the same window from this same picker a second later.
      if (res.reportId) {
        router.push(`/projects/${projectId}/reports/${res.reportId}`);
      }
    },
    onError: (err) => setError(err.message || "Failed to sync this period"),
  });

  const paywalled = canGenerate.data ? !canGenerate.data.allowed : false;
  const busy = generate.isPending || sync.isPending;
  // What the primary button does for the current selection. A period with no
  // snapshot but a `createAction` is one sync away from being reportable, so
  // the button offers that sync instead of being dead.
  const mode: "generate" | "create" | "blocked" = !selected
    ? "blocked"
    : selected.snapshotId && selected.period && selected.disabledReason === null
      ? "generate"
      : selected.createAction
        ? "create"
        : "blocked";
  const blocked = mode === "blocked" || busy || (mode === "generate" && paywalled);

  function onPrimary() {
    if (!selected || busy) return;
    setError(null);
    if (mode === "generate") {
      if (!selected.snapshotId || !selected.period) return;
      generate.mutate({
        projectId,
        snapshotId: selected.snapshotId,
        // Sent explicitly rather than left to the server's default, so the
        // period the founder saw in this UI is the period the server checks
        // against the snapshot. A silent disagreement becomes a refusal instead
        // of a mislabelled report.
        period: { start: selected.period.start, end: selected.period.end },
        // Both left at "" (None) by default — `undefined` here so an
        // untouched selection sends exactly the same request body as before
        // these selectors existed.
        grantId: selectedGrantId || undefined,
        presetId: selectedPresetId || undefined,
      });
      return;
    }
    const action = selected.createAction;
    if (mode !== "create" || !action) return;
    // `months` and `period` are mutually exclusive on the mutation, which is
    // why `PeriodCreateAction` is a union rather than two optional fields.
    sync.mutate(
      action.kind === "months"
        ? { projectId, months: action.months }
        : { projectId, period: { start: action.start, end: action.end } }
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-[var(--vb-border)] bg-[var(--vb-card)] p-4">
      <p className="m-0 mb-3 font-[var(--font-space-grotesk),'Space_Grotesk',sans-serif] text-[15px] font-semibold text-[var(--vb-text)]">
        Generate a report
      </p>

      {paywalled && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-[var(--vb-border-strong)] bg-[rgba(240,184,71,0.08)] p-3">
          <Lock size={14} className="mt-0.5 shrink-0 text-[var(--vb-warn)]" />
          <p className="m-0 font-[var(--font-inter),Inter,sans-serif] text-[12px] leading-relaxed text-[var(--vb-muted)]">
            {canGenerate.data?.reason}
          </p>
        </div>
      )}

      <p className="m-0 mb-1 font-[var(--font-inter),Inter,sans-serif] text-[11px] uppercase tracking-wide text-[var(--vb-dim)]">
        Reporting period
      </p>
      {/* A visible list rather than a dropdown, and rather than a native
          <select> with disabled <option>s. Every unavailable period carries a
          reason the founder needs — usually the sync that would create it —
          and both of those controls can only hide it. */}
      <div
        role="radiogroup"
        aria-label="Reporting period"
        className="flex max-w-[560px] flex-col gap-1"
      >
        {options.map((opt) => {
          // Selectable ≠ generatable. An option with a `createAction` has no
          // snapshot yet, but selecting it is how the founder reaches the sync
          // that makes one — so only a window nothing can produce is dead.
          const creatable = opt.createAction !== null;
          const dead = opt.disabledReason !== null && !creatable;
          const active = opt.id === selectedId;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={dead}
              title={opt.disabledReason ?? undefined}
              onClick={() => {
                setPickedId(opt.id);
                setError(null);
              }}
              className="rounded-lg border px-3 py-2 text-left font-[var(--font-inter),Inter,sans-serif] text-[13px]"
              style={{
                borderColor: active
                  ? "var(--vb-border-hover)"
                  : "var(--vb-border)",
                background: active ? "var(--accent-dim)" : "var(--vb-alt)",
                color: dead ? "var(--vb-dim)" : "var(--vb-text)",
                cursor: dead ? "not-allowed" : "pointer",
              }}
            >
              <span className="block">
                {opt.label}
                {dead ? " — unavailable" : creatable ? " — not synced yet" : ""}
              </span>
              {(opt.disabledReason ?? opt.hint) && (
                <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--vb-dim)]">
                  {opt.disabledReason ?? opt.hint}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedId === CUSTOM_ID && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="vb-period-start"
              className="mb-1 block font-[var(--font-inter),Inter,sans-serif] text-[11px] text-[var(--vb-dim)]"
            >
              Start
            </label>
            <input
              id="vb-period-start"
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="rounded-lg border border-[var(--vb-border)] bg-[var(--vb-alt)] px-3 py-2 font-[var(--font-inter),Inter,sans-serif] text-[13px] text-[var(--vb-text)]"
            />
          </div>
          <div>
            <label
              htmlFor="vb-period-end"
              className="mb-1 block font-[var(--font-inter),Inter,sans-serif] text-[11px] text-[var(--vb-dim)]"
            >
              End
            </label>
            <input
              id="vb-period-end"
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="rounded-lg border border-[var(--vb-border)] bg-[var(--vb-alt)] px-3 py-2 font-[var(--font-inter),Inter,sans-serif] text-[13px] text-[var(--vb-text)]"
            />
          </div>
        </div>
      )}

      {selectedId === CUSTOM_ID && selected?.hint && (
        <p className="mt-2 mb-0 font-[var(--font-inter),Inter,sans-serif] text-[11px] leading-relaxed text-[var(--vb-dim)]">
          {selected.hint}
        </p>
      )}

      {/* The reason a period cannot be reported on, in plain sight rather than
          in a tooltip — it is usually an instruction the founder has to act on.
          The preset rows carry their own; this is the custom window's. */}
      {selectedId === CUSTOM_ID && selected?.disabledReason && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--vb-border-strong)] bg-[var(--vb-alt)] p-3">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--vb-muted)]" />
          <p className="m-0 font-[var(--font-inter),Inter,sans-serif] text-[12px] leading-relaxed text-[var(--vb-muted)]">
            {selected.disabledReason}
          </p>
        </div>
      )}

      {selected?.basis === "reconstructed" && (
        <ReconstructedBanner option={selected} />
      )}

      {(grantAwards.length > 0 || (presetsQ.data?.length ?? 0) > 0) && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          {grantAwards.length > 0 && (
            <div>
              <label
                htmlFor="vb-report-grant"
                className="mb-1 block font-[var(--font-inter),Inter,sans-serif] text-[11px] text-[var(--vb-dim)]"
              >
                Report about
              </label>
              <select
                id="vb-report-grant"
                value={selectedGrantId}
                onChange={(e) => setSelectedGrantId(e.target.value)}
                className="rounded-lg border border-[var(--vb-border)] bg-[var(--vb-alt)] px-3 py-2 font-[var(--font-inter),Inter,sans-serif] text-[13px] text-[var(--vb-text)]"
              >
                <option value="">None — general report</option>
                {grantAwards.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.program ? `${a.grantor} — ${a.program}` : a.grantor}
                  </option>
                ))}
              </select>
            </div>
          )}
          {(presetsQ.data?.length ?? 0) > 0 && (
            <div>
              <label
                htmlFor="vb-report-preset"
                className="mb-1 block font-[var(--font-inter),Inter,sans-serif] text-[11px] text-[var(--vb-dim)]"
              >
                Template
              </label>
              <select
                id="vb-report-preset"
                value={selectedPresetId}
                onChange={(e) => setSelectedPresetId(e.target.value)}
                className="rounded-lg border border-[var(--vb-border)] bg-[var(--vb-alt)] px-3 py-2 font-[var(--font-inter),Inter,sans-serif] text-[13px] text-[var(--vb-text)]"
              >
                <option value="">None — this project&apos;s template</option>
                {presetsQ.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onPrimary}
          disabled={blocked}
          title={
            mode === "create"
              ? "Creates the snapshot for this window, then generates its report."
              : (selected?.disabledReason ??
                (paywalled ? (canGenerate.data?.reason ?? undefined) : undefined))
          }
          className="inline-flex items-center gap-2 rounded-lg border-none px-[18px] py-[11px] font-[var(--font-inter),Inter,sans-serif] text-[14px] font-semibold"
          style={{
            background: blocked ? "rgba(255,255,255,0.06)" : "var(--accent)",
            color: blocked ? "var(--vb-dim)" : "var(--accent-text)",
            cursor: blocked ? "not-allowed" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {mode === "create" ? <RefreshCw size={14} /> : <Sparkles size={14} />}
          {sync.isPending
            ? "Syncing this period..."
            : generate.isPending
              ? "Generating report..."
              : mode === "create"
                ? `Sync ${selected?.period?.label ?? "this period"}`
                : selected?.period
                  ? `Generate report for ${selected.period.label}`
                  : "Generate report"}
        </button>
        {/* What the sync will actually do, before it is paid for. A custom
            window is one live treasury read plus a transfer sweep over the
            whole window, and `projects.sync` generates the report for the
            period it writes — so this button is not just "fetch data". */}
        {mode === "create" && !busy && (
          <span className="max-w-[420px] font-[var(--font-inter),Inter,sans-serif] text-[11px] leading-relaxed text-[var(--vb-dim)]">
            {selected?.createAction?.kind === "period"
              ? "Reads the treasury now, measures this window's transfers, and generates the report."
              : "Backfills the missing months, reconstructing older balances from transfer history, and generates the report for the newest one."}
          </span>
        )}
        {error && (
          <span className="font-[var(--font-inter),Inter,sans-serif] text-[12px] text-[var(--vb-danger)]">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The reconstructed-balance disclosure.
 *
 * Deliberately loud and deliberately BEFORE the generate button. Every line
 * here is a documented limitation of the walk-back rather than boilerplate: a
 * clamped position is a floor and not a measurement, an unpriced token is
 * carried at zero USD, a carried-forward wallet was not walked back at all, and
 * native-token gas is a systematic understatement because gas is not a
 * transfer. `reconstruction_meta.notes` carries whichever of those actually
 * applied to this row, written by the reconstruction itself.
 */
function ReconstructedBanner({ option }: { option: PeriodOption }) {
  const meta = option.reconstruction;
  const facts: string[] = [];
  if (typeof meta?.stepsFromObserved === "number" && meta.observedAsOf) {
    facts.push(
      `Walked back ${meta.stepsFromObserved} ${
        meta.stepsFromObserved === 1 ? "period" : "periods"
      } from the live reading of ${meta.observedAsOf}.`
    );
  }
  if (typeof meta?.clampedPositions === "number" && meta.clampedPositions > 0) {
    facts.push(
      `${meta.clampedPositions} position${
        meta.clampedPositions === 1 ? "" : "s"
      } went negative and were clamped to zero — those holdings are a floor, not a measurement.`
    );
  }
  if (typeof meta?.unpricedPositions === "number" && meta.unpricedPositions > 0) {
    const share =
      typeof meta.unpricedShareOfTotal === "number"
        ? ` (~${(meta.unpricedShareOfTotal * 100).toFixed(0)}% of the treasury)`
        : "";
    const symbols = meta.unpricedSymbols?.length
      ? `: ${meta.unpricedSymbols.join(", ")}`
      : "";
    facts.push(
      `${meta.unpricedPositions} position${
        meta.unpricedPositions === 1 ? "" : "s"
      } had no price at this date and are carried at zero USD${share}${symbols}.`
    );
  }
  const carried = meta?.carriedForwardWallets?.length ?? 0;
  if (carried > 0) {
    facts.push(
      `${carried} wallet${
        carried === 1 ? " was" : "s were"
      } carried forward unchanged because no transfer feed covers them.`
    );
  }
  for (const note of meta?.notes ?? []) facts.push(note);

  return (
    <div className="mt-3 rounded-lg border border-[var(--vb-warn)] bg-[rgba(240,184,71,0.08)] p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--vb-warn)]" />
        <div>
          <p className="m-0 font-[var(--font-inter),Inter,sans-serif] text-[13px] font-semibold text-[var(--vb-text)]">
            Balances for this period are reconstructed, not observed
          </p>
          <p className="mt-1 mb-0 font-[var(--font-inter),Inter,sans-serif] text-[12px] leading-relaxed text-[var(--vb-muted)]">
            This treasury was not read on {option.period?.end ?? "that date"}.
            Its holdings were walked backwards from today&apos;s balances through
            each period&apos;s transfer history and priced at that period&apos;s
            close. Flows over the period — inflows, outflows, burn, GitHub
            activity — are measured normally; only the balances are estimated,
            and every quantity the walk-back cannot see pushes them DOWN, so they
            are a floor. The report discloses this, but you are sending it.
          </p>
          {facts.length > 0 && (
            <ul className="mt-2 mb-0 list-disc pl-4 font-[var(--font-inter),Inter,sans-serif] text-[11px] leading-relaxed text-[var(--vb-muted)]">
              {facts.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
