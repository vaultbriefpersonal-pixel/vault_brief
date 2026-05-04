import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/server/db";
import { users, accounts, sessions, verificationTokens } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { sendMagicLinkEmail } from "@/server/services/email-sender";
import { loginLimiter, checkLimit } from "@/server/lib/ratelimit";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
    Resend({
      apiKey: process.env.RESEND_API_KEY!,
      from: process.env.RESEND_FROM_EMAIL ?? "noreply@vaultbrief.io",
      async sendVerificationRequest({ identifier, url }) {
        // Throttle by email so a single address can't spam the world (or
        // burn through Resend quota). Limiter throws TRPCError on miss; for
        // the non-TRPC NextAuth surface we surface as a generic Error.
        try {
          await checkLimit(loginLimiter, `email:${identifier.toLowerCase()}`);
        } catch (err) {
          throw new Error(
            err instanceof Error
              ? err.message
              : "Too many magic link requests."
          );
        }
        await sendMagicLinkEmail(identifier, url);
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async session({ session, user }) {
      if (session.user && user) {
        session.user.id = user.id;
        // Attach plan from users table
        const [dbUser] = await db
          .select({ plan: users.plan })
          .from(users)
          .where(eq(users.id, user.id));
        (session.user as typeof session.user & { plan: string }).plan =
          dbUser?.plan ?? "free";
      }
      return session;
    },
  },
  events: {
    /**
     * Fires once per account — on the first successful login (magic-link
     * click or Google OAuth callback). DrizzleAdapter has just inserted
     * the row with default `plan='free'` and `trialEndsAt=null`. We
     * stamp `trialEndsAt = now + 14 days` to start the trial clock.
     *
     * Why an event and not the adapter `createUser` override: events
     * fire AFTER the adapter persists the row, so we don't fight the
     * adapter's transaction. A 1-row UPDATE in the same DB is cheap
     * and the new value is visible to the very next request.
     */
    async createUser({ user }) {
      if (!user.id) return;
      const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      try {
        await db
          .update(users)
          .set({ trialEndsAt })
          .where(eq(users.id, user.id));
      } catch (err) {
        // Stamp failure shouldn't block sign-in — user just won't have
        // a trial window. Better to let them in and follow up than
        // 500 their first ever interaction with the product.
        console.error("auth.createUser: trial stamp failed", err);
      }
    },
  },
  session: {
    strategy: "database",
  },
});
