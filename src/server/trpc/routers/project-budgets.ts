import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { projectBudgets } from "@/server/db/schema";
import { requireProject, requireProjectBudget } from "../guards";
import { assertTrialActive } from "@/server/lib/plan-limits";
import { checkLimit, bulkImportLimiter } from "@/server/lib/ratelimit";
import { TRPCError } from "@trpc/server";
import {
  INCOME_CATEGORY_NAMES,
  TOTAL_BUDGET_CATEGORY,
} from "@/server/services/report-derived";
// Server-only import, and it must stay that way: expense-classifier.ts opens
// with `import OpenAI from "openai"`. tRPC routers never reach the client
// bundle, so pulling the category list from the module that DEFINES it is
// safe here — and it is the only place in the codebase where that is true.
// Anything in the report-sections.ts graph must keep mirroring the strings
// instead (see the note above splitIncome in report-derived.ts).
import { EXPENSE_CATEGORIES } from "@/server/services/expense-classifier";

// Same period shape as grants.ts and every other period-scoped router.
const PERIOD_RE = /^\d{4}-\d{2}$/;
const KINDS = ["expense", "income"] as const;

/**
 * The database stores `category` as free text on purpose — adding a category
 * later should be a code change, not a migration — so this router is the only
 * thing standing between a typo and a budget row that can never match an
 * actual. The two namespaces are kept disjoint by `kind`, exactly as the
 * schema comment describes: "grants" is a real ExpenseCategory while income
 * carries its own set, so the same string can be valid on one side and
 * meaningless on the other.
 */
const CATEGORIES_BY_KIND: Record<(typeof KINDS)[number], ReadonlySet<string>> = {
  expense: new Set<string>([...EXPENSE_CATEGORIES, TOTAL_BUDGET_CATEGORY]),
  income: new Set<string>([...INCOME_CATEGORY_NAMES, TOTAL_BUDGET_CATEGORY]),
};

/**
 * Finite and non-negative. `z.number()` alone admits NaN and Infinity —
 * both survive JSON transport through superjson, and both would land in a
 * numeric column as an unusable plan figure that every downstream variance
 * silently inherits.
 */
const plannedUsdSchema = z
  .number()
  .finite("Planned amount must be a finite number")
  .nonnegative("Planned amount cannot be negative");

const budgetRowShape = {
  period: z.string().regex(PERIOD_RE, "Period must be YYYY-MM"),
  kind: z.enum(KINDS),
  category: z.string().min(1).max(100),
  plannedUsd: plannedUsdSchema,
  notes: z.string().max(2000).optional().nullable(),
};

type BudgetRowInput = {
  period: string;
  kind: (typeof KINDS)[number];
  category: string;
  plannedUsd: number;
  notes?: string | null;
};

/** Attaches the category error to the field the founder typed into. */
function checkCategory(
  row: BudgetRowInput,
  ctx: z.RefinementCtx,
  path: (string | number)[] = ["category"]
) {
  if (!CATEGORIES_BY_KIND[row.kind].has(row.category)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: `Unknown ${row.kind} category "${row.category}". Use a real ${row.kind} category or "${TOTAL_BUDGET_CATEGORY}" for a single period total.`,
    });
  }
}

/**
 * The conflict target is the unique index the migration created. Naming the
 * columns rather than the index makes the upsert self-describing at the call
 * site — and makes it obvious that a change to the index has to be made here
 * too, rather than showing up as a duplicate-row bug in a variance table.
 */
const CONFLICT_TARGET = [
  projectBudgets.projectId,
  projectBudgets.period,
  projectBudgets.kind,
  projectBudgets.category,
] as const;

/**
 * `updatedAt` is set explicitly on every conflict. The column's `defaultNow()`
 * fires on INSERT only, so without this a revised plan would keep the
 * timestamp of the original — and the report prints "the plan was last
 * revised <date>" off exactly this field.
 *
 * A function, not a constant: `new Date()` in a module-level object is
 * evaluated once when the module loads, which on a warm serverless instance
 * means every revision for the life of that instance is stamped with the cold
 * start time. Called per request, it is the time the founder actually saved.
 */
function conflictUpdate() {
  return {
    plannedUsd: sql`excluded.planned_usd`,
    notes: sql`excluded.notes`,
    updatedAt: new Date(),
  };
}

export const projectBudgetsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        period: z.string().regex(PERIOD_RE).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await requireProject(ctx, input.projectId);
      return ctx.db.query.projectBudgets.findMany({
        where: input.period
          ? and(
              eq(projectBudgets.projectId, input.projectId),
              eq(projectBudgets.period, input.period)
            )
          : eq(projectBudgets.projectId, input.projectId),
        orderBy: (b, { asc, desc }) => [desc(b.period), asc(b.kind), asc(b.category)],
      });
    }),

  /**
   * One row, idempotent on (project, period, kind, category). Re-submitting a
   * category the founder already budgeted edits that row rather than adding a
   * second one — duplicates here would double-count in every plan-vs-actual
   * sum, which is the whole reason the unique index exists.
   */
  upsert: protectedProcedure
    .input(
      z
        .object({ projectId: z.string().uuid(), ...budgetRowShape })
        .superRefine((row, ctx) => checkCategory(row, ctx))
    )
    .mutation(async ({ ctx, input }) => {
      await assertTrialActive(ctx.session.user.id!);
      await requireProject(ctx, input.projectId);
      const [row] = await ctx.db
        .insert(projectBudgets)
        .values({
          projectId: input.projectId,
          period: input.period,
          kind: input.kind,
          category: input.category,
          plannedUsd: input.plannedUsd.toString(), // numeric column wants string
          notes: input.notes ?? null,
        })
        .onConflictDoUpdate({
          target: [...CONFLICT_TARGET],
          set: conflictUpdate(),
        })
        .returning();
      return row;
    }),

  /**
   * A whole month's plan in one write — the paste-a-budget path. Same conflict
   * handling as `upsert`, so re-pasting a corrected plan replaces it instead
   * of stacking a second copy underneath.
   */
  bulkUpsert: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        rows: z
          .array(z.object(budgetRowShape))
          .min(1)
          .max(200)
          .superRefine((rows, ctx) => {
            rows.forEach((row, i) =>
              checkCategory(row, ctx, [i, "category"])
            );
          }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTrialActive(ctx.session.user.id!);
      await requireProject(ctx, input.projectId);
      await checkLimit(bulkImportLimiter, ctx.session.user.id!);

      // Postgres refuses an ON CONFLICT DO UPDATE that would touch the same
      // row twice in one statement ("cannot affect row a second time"), so a
      // paste carrying the same category twice would 500 rather than save.
      // Collapse to last-wins first: the founder's final line for a category
      // is the one they meant, and it is what a second `upsert` call would
      // have left behind anyway.
      const deduped = new Map<string, (typeof input.rows)[number]>();
      for (const row of input.rows) {
        // `::` is collision-free here only BECAUSE all three parts are
        // constrained above: `period` matches /^\d{4}-\d{2}$/, `kind` is the
        // two-value enum, and `category` comes from the fixed [a-z_]+ lists
        // plus `__total__`. Loosen any of those to free text and this key
        // needs a delimiter that cannot appear in the values.
        deduped.set(`${row.period}::${row.kind}::${row.category}`, row);
      }

      const written = await ctx.db
        .insert(projectBudgets)
        .values(
          [...deduped.values()].map((row) => ({
            projectId: input.projectId,
            period: row.period,
            kind: row.kind,
            category: row.category,
            plannedUsd: row.plannedUsd.toString(),
            notes: row.notes ?? null,
          }))
        )
        .onConflictDoUpdate({
          target: [...CONFLICT_TARGET],
          set: conflictUpdate(),
        })
        .returning();

      return { count: written.length, rows: written };
    }),

  /**
   * Row-level ownership, not project-level: `requireProjectBudget` resolves
   * the row and checks the project that row actually belongs to, so a caller
   * who owns project A cannot delete a budget row belonging to project B by
   * passing A's id. The extra projectId match then rejects a mismatched pair
   * with the same NOT_FOUND the guards use — a caller who can already see the
   * row learns nothing from it, and one who cannot learns nothing either.
   */
  remove: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        budgetId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const row = await requireProjectBudget(ctx, input.budgetId);
      if (row.projectId !== input.projectId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db
        .delete(projectBudgets)
        .where(eq(projectBudgets.id, input.budgetId));
      return { success: true };
    }),
});
