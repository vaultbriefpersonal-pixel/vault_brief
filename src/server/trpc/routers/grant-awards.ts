import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { grantAwards, grantTranches } from "@/server/db/schema";
import {
  requireProject,
  requireGrantAward,
  requireGrantTranche,
} from "../guards";
import { assertTrialActive } from "@/server/lib/plan-limits";
import { TRPCError } from "@trpc/server";

/**
 * CRUD for grant awards this project RECEIVED, plus their disbursement
 * tranches.
 *
 * NOT `grants.ts`. That router owns the `grants` table — money the project
 * GIVES OUT, reported to investors as deployment efficiency. This one owns
 * `grant_awards` / `grant_tranches` — money a funder gave the project, and the
 * reader is that funder. See the header on `grantAwards` in schema.ts; the two
 * tables must never be merged and neither must these routers.
 *
 * Nothing consumes this yet: the report sections that read these rows land in
 * a later phase. It ships now so the data layer is complete and reviewable on
 * its own, matching how project-budgets.ts followed its migration.
 */

// Same shape as milestones.ts:10-12 — the established date convention for
// real `date` columns, as opposed to the 'YYYY-MM' PERIOD_RE the manual
// section tables use. These are dates, not periods, so this is the right one.
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const STATUS = ["active", "completed", "terminated"] as const;

/**
 * The allowed reporting cadences. Enforced HERE and not as a database CHECK,
 * the same call `project_budgets.category` documents in schema.ts: keeping the
 * set in the server's input schema means a fifth cadence is a code change
 * rather than another migration against prod.
 *
 * `milestone_based` is not a synonym for `ad_hoc`: the first reports when a
 * tranche's milestone lands (a schedule the award itself defines), the second
 * has no schedule at all. Collapsing them would make "when is the next report
 * due" unanswerable for exactly the awards that have an answer.
 */
const REPORTING_CADENCES = [
  "monthly",
  "quarterly",
  "milestone_based",
  "ad_hoc",
] as const;

/**
 * Finite and non-negative — the same reasoning project-budgets.ts spells out
 * for `plannedUsdSchema`: bare `z.number()` admits NaN and Infinity, both of
 * which survive superjson transport intact and land in a numeric column as an
 * unusable figure that every downstream sum silently inherits. Here that
 * figure is quoted back to a grantor as "Awarded" or "Received to date", so
 * the failure mode is worse than a bad variance — it is a wrong number in the
 * document the funding decision is made from.
 *
 * Non-negative rather than positive: a $0 tranche is a legitimate placeholder
 * for a milestone-gated line whose amount is not yet agreed.
 */
const amountUsdSchema = z
  .number()
  .finite("Amount must be a finite number")
  .nonnegative("Amount cannot be negative");

/** Token amounts get the same treatment — same column class, same hazard. */
const amountTokenSchema = z
  .number()
  .finite("Token amount must be a finite number")
  .nonnegative("Token amount cannot be negative");

/**
 * "Source of Truth" — Optimism's exact term, and the same schema as the copies
 * in grants.ts and milestones.ts.
 *
 * DELIBERATELY NOT `z.string().url()`: a bare tx hash and a bare address are
 * both legitimate answers and neither is a URL. On a tranche this is the wider
 * successor to `txHash`, which is kept and still accepted — the renderer
 * prefers this field and falls back to that one.
 */
const sourceOfTruthSchema = z.string().trim().max(500).optional().nullable();

const awardShape = {
  grantor: z.string().trim().min(1).max(200),
  program: z.string().trim().max(200).optional().nullable(),
  awardAmountUsd: amountUsdSchema.optional().nullable(),
  awardAmountToken: amountTokenSchema.optional().nullable(),
  awardTokenSymbol: z.string().trim().max(20).optional().nullable(),
  /**
   * What the money was worth ON ARRIVAL — deliberately a separate field from
   * `awardAmountUsd`, which is the figure the AGREEMENT states. For a
   * token-denominated award the two differ by whatever the token did between
   * signature and disbursement, and either one printed under the other's
   * heading is a number the grant never contained. See the column comment in
   * schema.ts. Same finite/non-negative guard as every other money field here.
   */
  amountUsdAtReceipt: amountUsdSchema.optional().nullable(),
  awardDate: ISO_DATE,
  reportingStartDate: ISO_DATE.optional().nullable(),
  reportingCadence: z.enum(REPORTING_CADENCES).optional().nullable(),
  // Nothing consumes this yet — Stage 8 reminders read it. Validated as a real
  // date now so the reminder job never meets a 'next Tuesday' in a date column.
  nextReportDue: ISO_DATE.optional().nullable(),
  status: z.enum(STATUS).default("active"),
  /**
   * What the project intends to do with grant money it has received and not
   * used. The FIGURE is derived from the tranche rows; this is the INTENT,
   * which no dataset contains and which grant programs are the ones actually
   * asking for. Read by the `leftover_funds` section alongside the number.
   */
  leftoverFundsPlan: z.string().trim().max(2000).optional().nullable(),
  /**
   * How the work departed from the plan the grant was awarded against.
   *
   * Optional HERE but not optional in the report: the `plan_deviation` section
   * renders an explicit "No changes to the original plan." when this is null,
   * because forcing an affirmative negative is the mechanic worth copying and
   * a blank box is not the same thing. The default lives in the section, not
   * in this schema and not in a column DEFAULT.
   */
  planDeviation: z.string().trim().max(2000).optional().nullable(),
  agreementUrl: z.string().url().max(500).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
};

const trancheShape = {
  label: z.string().trim().min(1).max(200),
  amountUsd: amountUsdSchema,
  expectedDate: ISO_DATE.optional().nullable(),
  receivedDate: ISO_DATE.optional().nullable(), // null = not yet disbursed
  /**
   * How much of THIS tranche has been used. NOT treasury spend and never
   * derived from it — see the column comment in schema.ts. Absent/null means
   * "not recorded", which the report states as such; it is never read as zero,
   * so the same finite/non-negative guard as every other money field applies
   * only to a value that was actually supplied.
   */
  utilizedUsd: amountUsdSchema.optional().nullable(),
  txHash: z.string().trim().max(120).optional().nullable(),
  sourceOfTruth: sourceOfTruthSchema,
  notes: z.string().max(2000).optional().nullable(),
};

/**
 * numeric columns take strings; null must pass through as null rather than
 * becoming the string "null" (which Postgres would reject) or 0 (which would
 * assert an award amount the agreement never stated).
 */
function numOrNull(v: number | null | undefined): string | null | undefined {
  if (v === undefined) return undefined; // absent in a PATCH = leave alone
  return v === null ? null : v.toString();
}

export const grantAwardsRouter = router({
  /**
   * Awards with their tranches nested, which is how every reader wants them —
   * "received to date" is a sum over the tranches of one award and a second
   * round trip to assemble it would let the two halves disagree.
   */
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProject(ctx, input.projectId);
      return ctx.db.query.grantAwards.findMany({
        where: eq(grantAwards.projectId, input.projectId),
        with: {
          tranches: {
            // Expected date first so the schedule reads in the order it pays
            // out; nulls sort last, which is where an unscheduled line belongs.
            orderBy: (t, { asc }) => [asc(t.expectedDate), asc(t.createdAt)],
          },
        },
        orderBy: (a, { desc }) => [desc(a.awardDate), desc(a.createdAt)],
      });
    }),

  createAward: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), ...awardShape }))
    .mutation(async ({ ctx, input }) => {
      await assertTrialActive(ctx.session.user.id!);
      await requireProject(ctx, input.projectId);
      const [row] = await ctx.db
        .insert(grantAwards)
        .values({
          projectId: input.projectId,
          grantor: input.grantor,
          program: input.program ?? null,
          awardAmountUsd: numOrNull(input.awardAmountUsd) ?? null,
          awardAmountToken: numOrNull(input.awardAmountToken) ?? null,
          awardTokenSymbol: input.awardTokenSymbol ?? null,
          amountUsdAtReceipt: numOrNull(input.amountUsdAtReceipt) ?? null,
          awardDate: input.awardDate,
          reportingStartDate: input.reportingStartDate ?? null,
          reportingCadence: input.reportingCadence ?? null,
          nextReportDue: input.nextReportDue ?? null,
          status: input.status,
          leftoverFundsPlan: input.leftoverFundsPlan ?? null,
          planDeviation: input.planDeviation ?? null,
          agreementUrl: input.agreementUrl ?? null,
          notes: input.notes ?? null,
        })
        .returning();
      return row;
    }),

  /**
   * Every field optional — a PATCH, not a PUT. `updatedAt` is stamped
   * explicitly because the column's `defaultNow()` fires on INSERT only; the
   * same trap project-budgets.ts documents, and a report that says "the award
   * record was last revised <date>" reads exactly this field.
   *
   * `new Date()` is evaluated per call, not at module load: a module-level
   * constant would stamp every revision for the life of a warm serverless
   * instance with that instance's cold-start time.
   */
  updateAward: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        grantor: awardShape.grantor.optional(),
        program: awardShape.program,
        awardAmountUsd: awardShape.awardAmountUsd,
        awardAmountToken: awardShape.awardAmountToken,
        awardTokenSymbol: awardShape.awardTokenSymbol,
        amountUsdAtReceipt: awardShape.amountUsdAtReceipt,
        awardDate: ISO_DATE.optional(),
        reportingStartDate: awardShape.reportingStartDate,
        reportingCadence: awardShape.reportingCadence,
        nextReportDue: awardShape.nextReportDue,
        status: z.enum(STATUS).optional(),
        leftoverFundsPlan: awardShape.leftoverFundsPlan,
        planDeviation: awardShape.planDeviation,
        agreementUrl: awardShape.agreementUrl,
        notes: awardShape.notes,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const {
        id,
        awardAmountUsd,
        awardAmountToken,
        amountUsdAtReceipt,
        ...rest
      } = input;
      await requireGrantAward(ctx, id);
      const [row] = await ctx.db
        .update(grantAwards)
        .set({
          ...rest,
          ...(awardAmountUsd !== undefined
            ? { awardAmountUsd: numOrNull(awardAmountUsd) }
            : {}),
          ...(awardAmountToken !== undefined
            ? { awardAmountToken: numOrNull(awardAmountToken) }
            : {}),
          // Same numeric-column treatment as the two above: a number becomes a
          // string, an explicit null clears the field, and absent means leave
          // the stored value alone.
          ...(amountUsdAtReceipt !== undefined
            ? { amountUsdAtReceipt: numOrNull(amountUsdAtReceipt) }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(grantAwards.id, id))
        .returning();
      return row;
    }),

  /**
   * Deleting an award takes its tranches with it (ON DELETE CASCADE — a
   * tranche has no meaning without its award) but NOT its milestones: that FK
   * is ON DELETE SET NULL, so shipped-work history survives and simply stops
   * being attributed to this award. Both are database-level, so they hold for
   * any writer, not just this procedure.
   */
  removeAward: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireGrantAward(ctx, input.id);
      await ctx.db.delete(grantAwards).where(eq(grantAwards.id, input.id));
      return { success: true };
    }),

  /**
   * The tranche's project is DERIVED from the award, never accepted from the
   * client. `requireGrantAward` is the whole authorisation step: it resolves
   * the award and NOT_FOUNDs unless the caller owns (or is a member of) the
   * project that award belongs to. Taking a `projectId` argument here would be
   * the bug — a caller could pass their own project id alongside someone
   * else's awardId and write a row into a stranger's award schedule.
   */
  createTranche: protectedProcedure
    .input(z.object({ grantAwardId: z.string().uuid(), ...trancheShape }))
    .mutation(async ({ ctx, input }) => {
      await assertTrialActive(ctx.session.user.id!);
      const award = await requireGrantAward(ctx, input.grantAwardId);
      const [row] = await ctx.db
        .insert(grantTranches)
        .values({
          grantAwardId: award.id,
          projectId: award.projectId, // from the award, not the caller
          label: input.label,
          amountUsd: input.amountUsd.toString(), // numeric column wants string
          expectedDate: input.expectedDate ?? null,
          receivedDate: input.receivedDate ?? null,
          // Same numeric-column treatment as amountUsd above, but nullable:
          // absent means the utilisation has not been reported, which the
          // report says out loud. It must never land as "0.00", which would
          // assert that an unreported tranche is entirely unspent.
          utilizedUsd: numOrNull(input.utilizedUsd) ?? null,
          txHash: input.txHash ?? null,
          sourceOfTruth: input.sourceOfTruth ?? null,
          notes: input.notes ?? null,
        })
        .returning();
      return row;
    }),

  /**
   * Re-parenting a tranche to a different award is allowed but re-checked:
   * `requireGrantTranche` proves the caller owns the tranche, and a second
   * `requireGrantAward` proves they own the destination. Without the second
   * check a caller could push their own tranche into someone else's award.
   * `projectId` is re-derived from the destination so the denormalised
   * ownership handle can never drift from the award it hangs off.
   */
  updateTranche: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        grantAwardId: z.string().uuid().optional(),
        label: trancheShape.label.optional(),
        amountUsd: amountUsdSchema.optional(),
        expectedDate: trancheShape.expectedDate,
        receivedDate: trancheShape.receivedDate,
        utilizedUsd: trancheShape.utilizedUsd,
        txHash: trancheShape.txHash,
        sourceOfTruth: trancheShape.sourceOfTruth,
        notes: trancheShape.notes,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, grantAwardId, amountUsd, utilizedUsd, ...rest } = input;
      await requireGrantTranche(ctx, id);

      let reparent = {};
      if (grantAwardId !== undefined) {
        const award = await requireGrantAward(ctx, grantAwardId);
        reparent = { grantAwardId: award.id, projectId: award.projectId };
      }

      const [row] = await ctx.db
        .update(grantTranches)
        .set({
          ...rest,
          ...reparent,
          ...(amountUsd !== undefined
            ? { amountUsd: amountUsd.toString() }
            : {}),
          // An explicit null CLEARS the utilisation back to "not recorded",
          // which a founder who entered a figure by mistake needs; absent
          // leaves the stored value alone. Same PATCH semantics as the award
          // amounts in `updateAward`.
          ...(utilizedUsd !== undefined
            ? { utilizedUsd: numOrNull(utilizedUsd) }
            : {}),
        })
        .where(eq(grantTranches.id, id))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  removeTranche: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireGrantTranche(ctx, input.id);
      await ctx.db.delete(grantTranches).where(eq(grantTranches.id, input.id));
      return { success: true };
    }),
});
