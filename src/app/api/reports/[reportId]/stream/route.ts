import type { NextRequest } from "next/server";
import { TRPCError } from "@trpc/server";
import { streamGenerateReport } from "@/server/services/report-generator";
import { createContext } from "@/server/trpc/context";
import { requireReport } from "@/server/trpc/guards";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Server-Sent Events stream for a report regeneration. Each chunk is one
 * delta from the LLM. On done, the full markdown is persisted via the
 * cache; client should hit reports.update mutation to also save to the
 * report row.
 *
 * Auth: reuses `requireReport` — the same owner-OR-project-member guard
 * every other report-access path in the app uses, rather than a hand-rolled
 * owner-only check that drifts from the real access model.
 * Idempotency: streamGenerateReport hits the LLM cache first, so a repeat
 * stream against the same snapshot is instant (one chunk = full cached output).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const ctx = await createContext(req);
  if (!ctx.session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { reportId } = await params;
  let report;
  try {
    report = await requireReport(
      ctx as typeof ctx & { session: NonNullable<typeof ctx.session> },
      reportId
    );
  } catch (err) {
    if (err instanceof TRPCError) {
      const status = err.code === "NOT_FOUND" ? 404 : 403;
      return new Response(err.message || "Forbidden", { status });
    }
    throw err;
  }
  if (!report.snapshotId) {
    return new Response("Report has no snapshot to regenerate from", { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: string) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${data.replace(/\n/g, "\\n")}\n\n`)
        );
      };
      try {
        for await (const chunk of streamGenerateReport(
          report.projectId,
          report.snapshotId!
        )) {
          send("chunk", chunk);
        }
        send("done", "ok");
      } catch (err) {
        send(
          "error",
          err instanceof Error ? err.message : "stream failed"
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
