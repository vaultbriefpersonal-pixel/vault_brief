import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import * as relations from "./relations";

type DrizzleDB = ReturnType<typeof drizzle<typeof schema & typeof relations>>;

// Lazy init: Trigger.dev's task indexing imports modules before its env loader
// runs, so `process.env.DATABASE_URL` reads as the literal ".env.local" path
// during deploy and `neon()` rejects it. Deferring construction until first
// access keeps that flow alive while still giving Auth.js a working object.
let _db: DrizzleDB | undefined;

function getDb(): DrizzleDB {
  if (!_db) {
    const sql = neon(process.env.DATABASE_URL!);
    _db = drizzle(sql, { schema: { ...schema, ...relations } });
  }
  return _db;
}

// Full-transparency Proxy so Auth.js / Drizzle adapter duck-typing checks pass.
export const db: DrizzleDB = new Proxy({} as DrizzleDB, {
  get: (_, prop) => Reflect.get(getDb(), prop),
  has: (_, prop) => Reflect.has(getDb(), prop),
  getPrototypeOf: () => Reflect.getPrototypeOf(getDb()),
  ownKeys: () => Reflect.ownKeys(getDb()),
  getOwnPropertyDescriptor: (_, prop) =>
    Reflect.getOwnPropertyDescriptor(getDb(), prop),
  set: (_, prop, value) => Reflect.set(getDb(), prop, value),
});

export type DB = DrizzleDB;
