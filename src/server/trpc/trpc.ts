import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // Strip the stack trace from JSON responses entirely. The default
    // Next.js / tRPC behaviour leaks file paths in dev mode (it's hidden
    // in prod), but those file paths reveal repo layout to anyone curling
    // the API. Keep the error code + message; drop the stack string.
    const { stack: _stack, ...dataWithoutStack } = shape.data ?? {};
    void _stack;
    return {
      ...shape,
      data: {
        ...dataWithoutStack,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      session: { ...ctx.session, user: ctx.session.user },
    },
  });
});
