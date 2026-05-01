import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { projects } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { Plus, ExternalLink } from "lucide-react";

export default async function ProjectsPage() {
  const session = await auth();
  const userProjects = await db.query.projects.findMany({
    where: eq(projects.userId, session!.user!.id!),
    with: { wallets: true },
    orderBy: (p, { desc }) => [desc(p.createdAt)],
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-white">Projects</h2>
        <Link
          href="/projects/new"
          className="flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          <Plus className="h-4 w-4" />
          New project
        </Link>
      </div>

      {userProjects.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-12 text-center">
          <p className="text-slate-400 mb-4">No projects yet.</p>
          <Link
            href="/projects/new"
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors"
          >
            <Plus className="h-4 w-4" />
            Create your first project
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {userProjects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="rounded-xl border border-slate-800 bg-slate-900 p-6 hover:border-slate-700 transition-colors block"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold text-white">{project.name}</h3>
                {project.website && (
                  <ExternalLink className="h-4 w-4 text-slate-500 shrink-0" />
                )}
              </div>
              {project.description && (
                <p className="text-sm text-slate-400 mb-4 line-clamp-2">
                  {project.description}
                </p>
              )}
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <span>{project.wallets.length} wallet(s)</span>
                {project.tokenSymbol && <span>${project.tokenSymbol}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
