import OpenAI from "openai";
import { db } from "@/server/db";
import {
  reports,
  treasurySnapshots,
  projects,
  milestones,
} from "@/server/db/schema";
import { and, eq, lt, desc } from "drizzle-orm";
import {
  REPORT_SYSTEM_PROMPT,
  buildReportPrompt,
  validateReportNumbers,
} from "./prompts";

const MODEL = "google/gemini-2.5-flash";

const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

async function callLLM(system: string, user: string): Promise<string> {
  const response = await openrouter.chat.completions.create({
    model: MODEL,
    max_tokens: 3000,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return response.choices[0]?.message?.content ?? "";
}

export async function generateReport(
  projectId: string,
  snapshotId: string
): Promise<string> {
  const [snapshot, project] = await Promise.all([
    db.query.treasurySnapshots.findFirst({
      where: eq(treasurySnapshots.id, snapshotId),
    }),
    db.query.projects.findFirst({ where: eq(projects.id, projectId) }),
  ]);

  if (!snapshot || !project) throw new Error("Snapshot or project not found");

  const prevSnapshot = await db.query.treasurySnapshots.findFirst({
    where: and(
      eq(treasurySnapshots.projectId, projectId),
      lt(treasurySnapshots.snapshotDate, snapshot.snapshotDate)
    ),
    orderBy: [desc(treasurySnapshots.snapshotDate)],
  });

  const userPrompt = buildReportPrompt(snapshot, prevSnapshot, project);

  let markdown = await callLLM(REPORT_SYSTEM_PROMPT, userPrompt);

  const validation = validateReportNumbers(markdown, snapshot);
  if (!validation.passed && validation.issues.length > 0) {
    const correctionPrompt = `The previous report had these accuracy issues:
${validation.issues.join("\n")}

Please regenerate the report, ensuring all numbers exactly match the data provided.

${userPrompt}`;

    markdown = await callLLM(REPORT_SYSTEM_PROMPT, correctionPrompt);
  }

  // Extract executive summary (first paragraph after "### Executive Summary")
  const execSummaryMatch = markdown.match(
    /###\s*Executive Summary\s*\n+([\s\S]+?)(?=\n###|\n##|$)/
  );
  const executiveSummary = execSummaryMatch?.[1]?.trim() ?? null;

  return markdown;
}

export async function createReportRecord(
  projectId: string,
  snapshotId: string,
  contentMd: string
): Promise<typeof reports.$inferSelect> {
  const snapshot = await db.query.treasurySnapshots.findFirst({
    where: eq(treasurySnapshots.id, snapshotId),
  });
  if (!snapshot) throw new Error("Snapshot not found");

  const periodEnd = new Date(snapshot.snapshotDate);
  const periodStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);

  const execSummaryMatch = contentMd.match(
    /###\s*Executive Summary\s*\n+([\s\S]+?)(?=\n###|\n##|$)/
  );
  const executiveSummary = execSummaryMatch?.[1]?.trim() ?? null;

  const [report] = await db
    .insert(reports)
    .values({
      projectId,
      snapshotId,
      periodStart: periodStart.toISOString().split("T")[0],
      periodEnd: periodEnd.toISOString().split("T")[0],
      contentMd,
      executiveSummary,
      status: "draft",
    })
    .returning();

  return report;
}

export async function generateAndSaveReport(
  projectId: string,
  snapshotId: string
) {
  const markdown = await generateReport(projectId, snapshotId);
  return createReportRecord(projectId, snapshotId, markdown);
}
