import { z } from "zod";
import { eq, isNull, or } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { presets } from "@/server/db/schema";
import {
  requireProject,
  requirePresetUsableBy,
  requireOwnedPreset,
} from "../guards";
import { assertTrialActive } from "@/server/lib/plan-limits";

/**
 * CRUD for report presets — reusable block-configs a founder can pick per
 * generation (`reports.generate`'s `presetId` input) instead of always
 * rendering the project's own live `reportSections` template.
 *
 * System presets (`projectId === null`, seeded by
 * scripts/migrations/add-report-presets.mjs — generic_grant, minimal,
 * forum_post) are usable by every project but owned by none: `update`/
 * `delete` are guarded to project-owned rows only (`requireOwnedPreset`),
 * and `duplicate` is the ONLY way to get a project-owned row that started
 * from one — matching "duplicate-and-modify from any system preset".
 */

/** Identical shape to `projects.reportSections`: {id, enabled}[]. */
const blockConfigEntrySchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
});

/**
 * Enforced in Zod only, not a DB CHECK — same anti-pattern precedent as
 * `grant_awards.reportingCadence`. Unread until Stage 7's export path.
 */
const EXPORT_FORMATS = ["pdf", "markdown"] as const;

export const presetsRouter = router({
  /**
   * Every preset this project may USE: the system presets (`projectId IS
   * NULL`) plus this project's own. Not scoped further — a project cannot
   * see another project's presets, but system presets carry no owner to
   * check against.
   */
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProject(ctx, input.projectId);
      return ctx.db.query.presets.findMany({
        where: or(
          isNull(presets.projectId),
          eq(presets.projectId, input.projectId)
        ),
        // System presets first. Plain `asc(p.projectId)` would NOT do this —
        // Postgres's default for ASC is NULLS LAST, which would put every
        // system preset (projectId IS NULL) at the end. Ordering by the
        // boolean `projectId IS NULL` DESC puts true (system) before false
        // (project-owned) instead.
        orderBy: (p, { asc, sql }) => [
          sql`${p.projectId} IS NULL DESC`,
          asc(p.name),
        ],
      });
    }),

  /**
   * The only creation path. `sourcePresetId` may be a system preset or one
   * this project already owns — `requirePresetUsableBy` accepts either — and
   * only `blockConfig` + `defaultExportFormat` are copied; the new row is
   * always owned by `input.projectId`, never by the source's project.
   */
  duplicate: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        sourcePresetId: z.string().uuid(),
        name: z.string().trim().min(1).max(200),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTrialActive(ctx.session.user.id!);
      await requireProject(ctx, input.projectId);
      const source = await requirePresetUsableBy(
        ctx,
        input.sourcePresetId,
        input.projectId
      );
      const [row] = await ctx.db
        .insert(presets)
        .values({
          projectId: input.projectId,
          name: input.name,
          blockConfig: source.blockConfig,
          defaultExportFormat: source.defaultExportFormat,
        })
        .returning();
      return row;
    }),

  /** PATCH semantics — every field optional. Guarded to non-system rows only. */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(200).optional(),
        blockConfig: z.array(blockConfigEntrySchema).optional(),
        defaultExportFormat: z.enum(EXPORT_FORMATS).optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      await requireOwnedPreset(ctx, id);
      const [row] = await ctx.db
        .update(presets)
        .set({ ...rest, updatedAt: new Date() })
        .where(eq(presets.id, id))
        .returning();
      return row;
    }),

  /** Guarded to non-system rows only. Reports that used this preset are
   * unaffected — `reports.presetId` is `ON DELETE SET NULL`. */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireOwnedPreset(ctx, input.id);
      await ctx.db.delete(presets).where(eq(presets.id, input.id));
      return { success: true };
    }),
});
