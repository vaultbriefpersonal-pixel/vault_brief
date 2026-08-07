import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { wallets, treasurySnapshots } from "@/server/db/schema";
import { TRPCError } from "@trpc/server";
import { requireProject } from "../guards";
import { checkLimit, mutationLimiter } from "@/server/lib/ratelimit";
import { assertTrialActive } from "@/server/lib/plan-limits";
import { getSafeInfoForProject } from "@/server/services/safe-info";
import { viewWalletBalances } from "@/server/services/wallet-balances";

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function validateWalletAddress(address: string, chain: string): boolean {
  if (chain === "solana") return SOLANA_ADDRESS_RE.test(address);
  return EVM_ADDRESS_RE.test(address);
}

export const walletsRouter = router({
  /**
   * Wallet rows, each carrying its balance as of the latest snapshot.
   *
   * The balance is attached here rather than exposed as a second procedure
   * because there is no useful version of this page WITHOUT it: showing a
   * founder six addresses and no figures is what let a treasury assembled
   * from the wrong multisigs look identical to one assembled from the right
   * ones. See wallet-balances.ts for why `null` and `0` stay distinct.
   */
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const project = await requireProject(ctx, input.projectId);
      const rows = await ctx.db.query.wallets.findMany({
        where: eq(wallets.projectId, input.projectId),
        orderBy: (w, { asc }) => [asc(w.createdAt)],
      });

      const snapshot = await ctx.db.query.treasurySnapshots.findFirst({
        where: eq(treasurySnapshots.projectId, input.projectId),
        orderBy: [desc(treasurySnapshots.snapshotDate)],
      });

      const views = viewWalletBalances({
        wallets: rows,
        balancesDetail: snapshot?.balancesDetail ?? null,
        syncWarnings: snapshot?.syncWarnings ?? null,
        project,
        hasSnapshot: Boolean(snapshot),
      });

      // Index-aligned by construction: viewWalletBalances maps over the same
      // array in the same order and never filters.
      return rows.map((w, i) => ({ ...w, balance: views[i] }));
    }),

  // Signer count + threshold for any wallet tagged gnosis_safe, read live
  // on-chain (see safe-info.ts for why this isn't cached). Powers the
  // "Secured by a 3-of-5 multisig" trust signal on the report editor.
  getSafeInfo: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProject(ctx, input.projectId);
      return getSafeInfoForProject(input.projectId);
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

      // Public-goods pivot: no per-plan wallet cap — any number of wallets
      // per project. (Previously gated on PLAN_WALLET_LIMITS.)

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

