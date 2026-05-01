"use client";

import { use, useState } from "react";
import { trpc } from "@/lib/api";
import { Trash2, Plus, UserPlus } from "lucide-react";

interface Props {
  params: Promise<{ id: string }>;
}

export default function InvestorsPage({ params }: Props) {
  const { id: projectId } = use(params);
  const [form, setForm] = useState({ name: "", email: "", firm: "", role: "" });
  const [error, setError] = useState<string | null>(null);

  const { data: investorList, refetch } = trpc.investors.list.useQuery({
    projectId,
  });

  const add = trpc.investors.add.useMutation({
    onSuccess: () => {
      setForm({ name: "", email: "", firm: "", role: "" });
      setError(null);
      refetch();
    },
    onError: (e) => setError(e.message),
  });

  const remove = trpc.investors.remove.useMutation({
    onSuccess: () => refetch(),
  });

  const inputCls =
    "rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500";

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-xl font-semibold text-white mb-6">Investors</h2>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 mb-6">
        <h3 className="text-sm font-medium text-slate-300 mb-4 flex items-center gap-2">
          <UserPlus className="h-4 w-4" />
          Add investor
        </h3>
        {error && (
          <div className="mb-3 rounded-lg bg-red-950 border border-red-800 p-3 text-sm text-red-300">
            {error}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input
            className={inputCls}
            placeholder="Full name *"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <input
            type="email"
            className={inputCls}
            placeholder="Email *"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          <input
            className={inputCls}
            placeholder="Firm (e.g. a16z)"
            value={form.firm}
            onChange={(e) => setForm((f) => ({ ...f, firm: e.target.value }))}
          />
          <input
            className={inputCls}
            placeholder="Role (e.g. Lead Investor)"
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
          />
        </div>
        <button
          onClick={() =>
            add.mutate({
              projectId,
              name: form.name,
              email: form.email,
              firm: form.firm || undefined,
              role: form.role || undefined,
            })
          }
          disabled={!form.name || !form.email || add.isPending}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add investor
        </button>
      </div>

      <div className="space-y-2">
        {investorList?.length === 0 && (
          <p className="text-slate-500 text-sm text-center py-8">
            No investors added yet.
          </p>
        )}
        {investorList?.map((inv) => (
          <div
            key={inv.id}
            className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-4 py-3"
          >
            <div>
              <p className="font-medium text-white text-sm">{inv.name}</p>
              <p className="text-xs text-slate-400">
                {inv.email}
                {inv.firm && ` · ${inv.firm}`}
                {inv.role && ` · ${inv.role}`}
              </p>
            </div>
            <button
              onClick={() => remove.mutate({ investorId: inv.id })}
              className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-950 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
