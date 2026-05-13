import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { wallets } from "@/server/db/schema";
import { TRPCError } from "@trpc/server";
import { requireProject } from "../guards";
import { checkLimit, mutationLimiter } from "@/server/lib/ratelimit";
import { assertTrialActive } from "@/server/lib/plan-limits";

// Wallet quota per plan. Aligned with marketing pricing-table:
//   Seed (starter) = 5, Growth = 10, Custom (vc_suite) = unlimited.
// Used to read 20 on Growth — generous, but inconsistent with what
// the upgrade page advertises.
const PLAN_WALLET_LIMITS: Record<string, number> = {
  free: 5,
  starter: 5,
  growth: 10,
  vc_suite: Infinity,
};

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function validateWalletAddress(address: string, chain: string): boolean {
  if (chain === "solana") return SOLANA_ADDRESS_RE.test(address);
  return EVM_ADDRESS_RE.test(address);
}

export const walletsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProject(ctx, input.projectId);
      return ctx.db.query.wallets.findMany({
        where: eq(wallets.projectId, input.projectId),
        orderBy: (w, { asc }) => [asc(w.createdAt)],
      });
    }),

  add: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        address: z.string().min(1),
        chain: z.enum([
          "ethereum",
          "polygon",
          "arbitrum",
          "base",
          "optimism",
          "solana",
        ]),
        label: z.string().max(100).optional(),
        walletType: z.enum(["eoa", "gnosis_safe", "exchange"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTrialActive(ctx.session.user.id!);
      await requireProject(ctx, input.projectId);
      await checkLimit(mutationLimiter, `wallet-add:${ctx.session.user.id}`);

      if (!validateWalletAddress(input.address, input.chain)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid wallet address for the selected chain.",
        });
      }

      const plan =
        (ctx.session.user as { plan?: string }).plan ?? "free";
      const limit = PLAN_WALLET_LIMITS[plan] ?? 5;
      const existing = await ctx.db.query.wallets.findMany({
        where: eq(wallets.projectId, input.projectId),
      });
      if (existing.length >= limit) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Your plan allows up to ${limit} wallets per project.`,
        });
      }

      try {
        const [wallet] = await ctx.db
          .insert(wallets)
          .values(input)
          .returning();
        return wallet;
      } catch (err) {
        // Postgres 23505 = unique_violation. Schema has a unique index on
        // (projectId, address, chain) — friendlier than the raw "Failed query"
        // wrapper Drizzle would otherwise surface.
        const code = (err as { code?: string; cause?: { code?: string } })
          ?.code
          ?? (err as { cause?: { code?: string } })?.cause?.code;
        if (code === "23505") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This wallet is already added on this chain.",
          });
        }
        throw err;
      }
    }),

  remove: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        walletId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireProject(ctx, input.projectId);
      await ctx.db
        .delete(wallets)
        .where(
          and(
            eq(wallets.id, input.walletId),
            eq(wallets.projectId, input.projectId)
          )
        );
      return { success: true };
    }),

  verify: protectedProcedure
    .input(
      z.object({
        address: z.string(),
        chain: z.string(),
      })
    )
    .query(async ({ input }) => {
      const valid = validateWalletAddress(input.address, input.chain);
      return { valid };
    }),
});

