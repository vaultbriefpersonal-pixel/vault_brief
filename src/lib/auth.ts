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
  session: {
    strategy: "database",
  },
});
