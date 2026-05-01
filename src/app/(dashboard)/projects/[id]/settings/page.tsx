"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/api";

interface Props {
  params: Promise<{ id: string }>;
}

export default function ProjectSettingsPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const { data: project } = trpc.projects.getById.useQuery({ id });
  const [form, setForm] = useState({
    name: "",
    website: "",
    description: "",
    tokenSymbol: "",
    githubOrg: "",
    teamSize: "",
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (project) {
      setForm({
        name: project.name,
        website: project.website ?? "",
        description: project.description ?? "",
        tokenSymbol: project.tokenSymbol ?? "",
        githubOrg: project.githubOrg ?? "",
        teamSize: project.teamSize?.toString() ?? "",
      });
    }
  }, [project]);

  const update = trpc.projects.update.useMutation({
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const deleteProject = trpc.projects.delete.useMutation({
    onSuccess: () => router.push("/projects"),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    update.mutate({
      id,
      name: form.name,
      website: form.website || null,
      description: form.description || null,
      tokenSymbol: form.tokenSymbol || null,
      githubOrg: form.githubOrg || null,
      teamSize: form.teamSize ? parseInt(form.teamSize) : null,
    });
  }

  const inputCls =
    "w-full rounded-lg bg-slate-800 border border-slate-700 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500";

  return (
    <div className="p-6 max-w-lg">
      <h2 className="text-xl font-semibold text-white mb-6">
        Project settings
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4 mb-10">
        {(
          [
            ["name", "Project name", "text", true],
            ["website", "Website", "url", false],
            ["description", "Description", "text", false],
            ["tokenSymbol", "Token symbol", "text", false],
            ["githubOrg", "GitHub org", "text", false],
            ["teamSize", "Team size", "number", false],
          ] as const
        ).map(([key, label, type, required]) => (
          <div key={key}>
            <label className="block text-sm text-slate-400 mb-1">
              {label}
              {required && <span className="text-red-400 ml-1">*</span>}
            </label>
            <input
              type={type}
              required={required}
              className={inputCls}
              value={form[key]}
              onChange={(e) =>
                setForm((f) => ({ ...f, [key]: e.target.value }))
              }
            />
          </div>
        ))}

        <button
          type="submit"
          disabled={update.isPending}
          className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2.5 text-sm font-medium text-white transition-colors"
        >
          {saved ? "Saved!" : update.isPending ? "Saving..." : "Save changes"}
        </button>
      </form>

      <div className="rounded-xl border border-red-900 bg-red-950/30 p-5">
        <h3 className="text-sm font-semibold text-red-400 mb-2">
          Danger zone
        </h3>
        <p className="text-sm text-slate-400 mb-4">
          Deleting this project will remove all wallets, snapshots, and reports
          permanently.
        </p>
        <button
          onClick={() => {
            if (
              window.confirm(
                "Delete this project? This cannot be undone."
              )
            ) {
              deleteProject.mutate({ id });
            }
          }}
          disabled={deleteProject.isPending}
          className="rounded-lg border border-red-700 text-red-400 hover:bg-red-900/50 disabled:opacity-50 px-4 py-2 text-sm transition-colors"
        >
          {deleteProject.isPending ? "Deleting..." : "Delete project"}
        </button>
      </div>
    </div>
  );
}
