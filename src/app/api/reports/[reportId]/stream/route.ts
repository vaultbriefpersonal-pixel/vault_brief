import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { reports } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { streamGenerateReport } from "@/server/services/report-generator";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Server-Sent Events stream for a report regeneration. Each chunk is one
 * delta from the LLM. On done, the full markdown is persisted via the
 * cache; client should hit reports.update mutation to also save to the
 * report row.
 *
 * Auth: standard session — same path as the rest of the app.
 * Idempotency: streamGenerateReport hits the LLM cache first, so a repeat
 * stream against the same snapshot is instant (one chunk = full cached output).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { reportId } = await params;
  const report = await db.query.reports.findFirst({
    where: eq(reports.id, reportId),
    with: { project: true },
  });
  if (!report) return new Response("Report not found", { status: 404 });
  if (report.project?.userId !== session.user.id) {
    return new Response("Forbidden", { status: 403 });
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
