import { runHealthChecks } from "@/server/services/health-checks";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const health = await runHealthChecks();
  const status = health.overall === "outage" ? 503 : 200;
  return Response.json(health, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
