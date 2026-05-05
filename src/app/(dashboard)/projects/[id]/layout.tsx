import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { projects } from "@/server/db/schema";
import { and, eq } from "drizzle-orm";
import { SyncNowButton } from "@/components/projects/SyncNowButton";
import { ProjectActionsMenu } from "@/components/projects/ProjectActionsMenu";
import { ProjectTabs } from "@/components/projects/ProjectTabs";

/**
 * Persistent project chrome: name + description + Sync now + kebab + tabs.
 *
 * Living in `/projects/[id]/layout.tsx` means every sub-page
 * (overview, wallets, reports, investors, settings, individual reports)
 * inherits the same header without each page re-implementing it. Before
 * this layout existed only `/projects/[id]/page.tsx` (Overview) showed
 * the project name; founders deep-linked into /reports lost the
 * project context entirely.
 *
 * One DB query at the layout level fetches ownership-scoped project +
 * relation counts. Pages still fetch their own data; the cost of
 * duplicate queries is trivial vs. the simplicity gain.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.userId, session!.user!.id!)),
    with: { wallets: true, reports: true, investors: true },
  });

  if (!project) notFound();

  return (
    <div style={{ padding: "24px 28px", minHeight: "100dvh" }}>
      <div
        style={{
          marginBottom: 16,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <h2
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: 18,
              fontWeight: 700,
              color: "var(--vb-text)",
              margin: "0 0 4px",
              letterSpacing: "-0.02em",
            }}
          >
            {project.name}
          </h2>
          {project.description && (
            <p
              style={{
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 14,
                color: "var(--vb-dim)",
                margin: 0,
                maxWidth: 720,
                lineHeight: 1.5,
                wordBreak: "break-word",
              }}
            >
              {project.description}
            </p>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SyncNowButton projectId={id} />
          <ProjectActionsMenu projectId={id} projectSlug={project.slug} />
        </div>
      </div>

      <ProjectTabs
        projectId={id}
        counts={{
          wallets: project.wallets.length,
          reports: project.reports.length,
          investors: project.investors.length,
        }}
      />

      {children}
    </div>
  );
}
