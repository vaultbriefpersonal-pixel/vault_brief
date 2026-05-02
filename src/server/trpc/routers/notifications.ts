import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { notifications } from "@/server/db/schema";

export const notificationsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.notifications.findMany({
      where: eq(notifications.userId, ctx.session.user.id!),
      orderBy: [desc(notifications.createdAt)],
      limit: 50,
    });
  }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ c: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ctx.session.user.id!),
          isNull(notifications.readAt)
        )
      );
    return rows[0]?.c ?? 0;
  }),

  markRead: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.id, input.id),
            eq(notifications.userId, ctx.session.user.id!)
          )
        );
      return { ok: true };
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, ctx.session.user.id!),
          isNull(notifications.readAt)
        )
      );
    return { ok: true };
  }),

  clear: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .delete(notifications)
      .where(eq(notifications.userId, ctx.session.user.id!));
    return { ok: true };
  }),
});
