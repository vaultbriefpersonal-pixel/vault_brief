import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import * as relations from "./relations";

type DrizzleDB = ReturnType<typeof drizzle<typeof schema & typeof relations>>;

let _db: DrizzleDB | undefined;

function getDb(): DrizzleDB {
  if (!_db) {
    const sql = neon(process.env.DATABASE_URL!);
    _db = drizzle(sql, { schema: { ...schema, ...relations } });
  }
  return _db;
}

// Full-transparency Proxy so Auth.js/Drizzle adapter instanceof/duck-type checks pass
export const db: DrizzleDB = new Proxy({} as DrizzleDB, {
  get(_, prop) {
    return Reflect.get(getDb(), prop);
  },
  has(_, prop) {
    return Reflect.has(getDb(), prop);
  },
  getPrototypeOf() {
    return Reflect.getPrototypeOf(getDb());
  },
  ownKeys() {
    return Reflect.ownKeys(getDb());
  },
  getOwnPropertyDescriptor(_, prop) {
    return Reflect.getOwnPropertyDescriptor(getDb(), prop);
  },
  set(_, prop, value) {
    return Reflect.set(getDb(), prop, value);
  },
});

export type DB = DrizzleDB;
