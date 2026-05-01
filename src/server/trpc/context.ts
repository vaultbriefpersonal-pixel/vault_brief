import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";

export async function createContext(req: NextRequest) {
  const session = await auth();
  return {
    db,
    session,
    req,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
