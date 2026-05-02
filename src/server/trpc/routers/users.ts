import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { users } from "@/server/db/schema";
import { TRPCError } from "@trpc/server";

export const usersRouter = router({
  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, ctx.session.user.id!),
      columns: {
        id: true,
        email: true,
        name: true,
        plan: true,
        emailNotifications: true,
        createdAt: true,
      },
    });
    if (!user) throw new TRPCError({ code: "NOT_FOUND" });
    return user;
  }),

  update: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80).optional().nullable(),
        emailNotifications: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(users)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(users.id, ctx.session.user.id!))
        .returning({
          id: users.id,
          name: users.name,
          email: users.email,
          emailNotifications: users.emailNotifications,
        });
      return updated;
    }),

  /**
   * Hard-delete the current user. Cascades through projects/wallets/reports
   * via existing FKs (onDelete: cascade). Frontend must follow up with
   * signOut() and redirect to /.
   */
  delete: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.delete(users).where(eq(users.id, ctx.session.user.id!));
    return { ok: true };
  }),
});
