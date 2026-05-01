"use client";

import { useSession } from "next-auth/react";

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  const { data: session } = useSession();

  return (
    <header className="h-16 flex items-center justify-between px-6 border-b border-slate-800 bg-slate-950">
      <h1 className="text-white font-semibold text-base">{title}</h1>
      {session?.user && (
        <div className="flex items-center gap-3">
          {session.user.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={session.user.image}
              alt={session.user.name ?? ""}
              className="h-8 w-8 rounded-full"
            />
          )}
          <span className="text-sm text-slate-400">{session.user.email}</span>
        </div>
      )}
    </header>
  );
}
