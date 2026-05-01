"use client";

import { useState } from "react";
import { use } from "react";
import { trpc } from "@/lib/api";
import { Plus, Trash2 } from "lucide-react";

const CHAINS = [
  { value: "ethereum", label: "Ethereum" },
  { value: "polygon", label: "Polygon" },
  { value: "arbitrum", label: "Arbitrum" },
  { value: "base", label: "Base" },
  { value: "optimism", label: "Optimism" },
  { value: "solana", label: "Solana" },
] as const;

type Chain = (typeof CHAINS)[number]["value"];

interface Props {
  params: Promise<{ id: string }>;
}

export default function WalletsPage({ params }: Props) {
  const { id: projectId } = use(params);
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState<Chain>("ethereum");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: walletList, refetch } = trpc.wallets.list.useQuery({ projectId });

  const addWallet = trpc.wallets.add.useMutation({
    onSuccess: () => {
      setAddress("");
      setLabel("");
      setError(null);
      refetch();
    },
    onError: (e) => setError(e.message),
  });

  const removeWallet = trpc.wallets.remove.useMutation({
    onSuccess: () => refetch(),
  });

  const inputCls =
    "rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500";

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-xl font-semibold text-white mb-6">Wallets</h2>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 mb-6">
        <h3 className="text-sm font-medium text-slate-300 mb-4">Add wallet</h3>
        {error && (
          <div className="mb-3 rounded-lg bg-red-950 border border-red-800 p-3 text-sm text-red-300">
            {error}
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          <input
            className={`${inputCls} flex-1 min-w-48`}
            placeholder="0x... or Solana address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <select
            className={`${inputCls} bg-slate-800`}
            value={chain}
            onChange={(e) => setChain(e.target.value as Chain)}
          >
            {CHAINS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            className={`${inputCls} w-36`}
            placeholder="Label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button
            onClick={() =>
              addWallet.mutate({
                projectId,
                address,
                chain,
                label: label || undefined,
              })
            }
            disabled={!address || addWallet.isPending}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {walletList?.length === 0 && (
          <p className="text-slate-500 text-sm text-center py-8">
            No wallets added yet.
          </p>
        )}
        {walletList?.map((w) => (
          <div
            key={w.id}
            className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-4 py-3"
          >
            <div>
              <p className="font-mono text-xs text-white break-all">{w.address}</p>
              <div className="flex gap-2 mt-1">
                <span className="text-xs text-slate-500 capitalize">{w.chain}</span>
                {w.label && (
                  <span className="text-xs text-slate-400">· {w.label}</span>
                )}
              </div>
            </div>
            <button
              onClick={() =>
                removeWallet.mutate({ projectId, walletId: w.id })
              }
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
