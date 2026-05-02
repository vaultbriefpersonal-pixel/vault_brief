import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { projects } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { Plus, ExternalLink, FolderOpen } from "lucide-react";

export default async function ProjectsPage() {
  const session = await auth();
  const userProjects = await db.query.projects.findMany({
    where: eq(projects.userId, session!.user!.id!),
    with: { wallets: true },
    orderBy: (p, { desc }) => [desc(p.createdAt)],
  });

  return (
    <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 28,
        }}
      >
        <h2
          style={{
            fontFamily:
              "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
            fontSize: 18,
            fontWeight: 700,
            color: "#f0f0f0",
            margin: 0,
            letterSpacing: "-0.02em",
          }}
        >
          Projects
        </h2>
        <Link
          href="/projects/new"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "#00e87b",
            color: "#0a0a0a",
            border: "none",
            borderRadius: 8,
            padding: "11px 20px",
            fontSize: 14,
            fontWeight: 600,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            textDecoration: "none",
          }}
        >
          <Plus size={13} />
          New project
        </Link>
      </div>

      {userProjects.length === 0 ? (
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background: "#161616",
            borderRadius: 14,
            padding: "72px 24px",
            textAlign: "center",
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "rgba(0,232,123,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px",
            }}
          >
            <FolderOpen size={24} color="#00e87b" />
          </div>
          <p
            style={{
              fontFamily:
                "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
              fontSize: 22,
              fontWeight: 600,
              color: "#f0f0f0",
              margin: "0 0 10px",
            }}
          >
            No projects yet
          </p>
          <p
            style={{
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 16,
              color: "#555555",
              margin: "0 0 28px",
            }}
          >
            Create your first project to start generating reports.
          </p>
          <Link
            href="/projects/new"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "#00e87b",
              color: "#0a0a0a",
              borderRadius: 8,
              padding: "14px 28px",
              fontSize: 15,
              fontWeight: 600,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              textDecoration: "none",
            }}
          >
            <Plus size={15} />
            Create your first project
          </Link>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {userProjects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              style={{
                display: "block",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "#161616",
                borderRadius: 14,
                padding: 24,
                textDecoration: "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  marginBottom: 10,
                }}
              >
                <h3
                  style={{
                    fontFamily:
                      "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
                    fontSize: 15,
                    fontWeight: 600,
                    color: "#f0f0f0",
                    margin: 0,
                  }}
                >
                  {project.name}
                </h3>
                {project.website && (
                  <ExternalLink size={13} color="#555555" />
                )}
              </div>
              {project.description && (
                <p
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 13,
                    color: "#888888",
                    margin: "0 0 16px",
                    lineHeight: 1.5,
                  }}
                >
                  {project.description}
                </p>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  style={{
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 12,
                    color: "#555555",
                  }}
                >
                  {project.wallets.length} wallet
                  {project.wallets.length !== 1 ? "s" : ""}
                </span>
                {project.tokenSymbol && (
                  <span
                    style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 12,
                      color: "#00e87b",
                    }}
                  >
                    ${project.tokenSymbol}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
