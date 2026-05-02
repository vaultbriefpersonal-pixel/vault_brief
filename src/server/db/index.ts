import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import * as relations from "./relations";

// Neon HTTP driver doesn't open a connection at construction time — it just
// stores the URL and dispatches a fetch on each query. So a plain singleton
// is fine here, no Proxy or lazy-init needed.
const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema: { ...schema, ...relations } });
export type DB = typeof db;
