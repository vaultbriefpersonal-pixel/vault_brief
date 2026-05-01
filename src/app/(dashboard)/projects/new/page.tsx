"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/api";

export default function NewProjectPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    website: "",
    description: "",
    tokenSymbol: "",
    githubOrg: "",
  });
  const [error, setError] = useState<string | null>(null);

  const createProject = trpc.projects.create.useMutation({
    onSuccess: (project) => router.push(`/projects/${project.id}`),
    onError: (e) => setError(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    createProject.mutate({
      name: form.name,
      website: form.website || undefined,
      description: form.description || undefined,
      tokenSymbol: form.tokenSymbol || undefined,
      githubOrg: form.githubOrg || undefined,
    });
  }

  function field(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm((f) => ({ ...f, [key]: e.target.value })),
    };
  }

  const inputCls =
    "w-full rounded-lg bg-slate-800 border border-slate-700 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500";

  return (
    <div className="p-6 max-w-lg">
      <h2 className="text-xl font-semibold text-white mb-6">New project</h2>

      {error && (
        <div className="mb-4 rounded-lg bg-red-950 border border-red-800 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-slate-400 mb-1">
            Project name <span className="text-red-400">*</span>
          </label>
          <input
            required
            placeholder="My Web3 Project"
            className={inputCls}
            {...field("name")}
          />
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">Website</label>
          <input
            type="url"
            placeholder="https://example.com"
            className={inputCls}
            {...field("website")}
          />
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">
            Description
          </label>
          <textarea
            rows={3}
            placeholder="What does your project do?"
            className={inputCls}
            {...field("description")}
          />
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">
            Token symbol (optional)
          </label>
          <input
            placeholder="USDC"
            className={inputCls}
            {...field("tokenSymbol")}
          />
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">
            GitHub org (optional)
          </label>
          <input
            placeholder="my-org"
            className={inputCls}
            {...field("githubOrg")}
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex-1 rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createProject.isPending}
            className="flex-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2.5 text-sm font-medium text-white transition-colors"
          >
            {createProject.isPending ? "Creating..." : "Create project"}
          </button>
        </div>
      </form>
    </div>
  );
}
