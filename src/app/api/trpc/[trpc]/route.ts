import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { NextRequest } from "next/server";
import { appRouter } from "@/server/trpc/router";
import { createContext } from "@/server/trpc/context";

// Safety-net timeout: this catch-all fronts every tRPC mutation, including
// reports.regenerate's synchronous LLM call (several to 15+s) + DB write.
// With no explicit maxDuration, Vercel falls back to its platform default
// for this project, which is shorter than what that LLM call alone needs —
// matches the 60s already used for the Stripe webhook and the
// /api/reports/[reportId]/{pdf,stream} routes (vercel.json and
// stream/route.ts respectively).
export const maxDuration = 60;

const handler = (req: NextRequest) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContext(req),
    onError:
      process.env.NODE_ENV === "development"
        ? ({ path, error }) => {
            console.error(`tRPC error on ${path ?? "<no-path>"}:`, error);
          }
        : undefined,
  });

export { handler as GET, handler as POST };
