import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

type Db = NodePgDatabase<typeof schema>;

let _pool: pg.Pool | null = null;
let _db: Db | null = null;

function getDb(): Db {
 if (_db) return _db;
 const url = process.env.DATABASE_URL;
 if (!url) {
 throw new Error(
 "DATABASE_URL must be set. Did you forget to provision a database?",
 );
 }
 _pool = new Pool({
 connectionString: url,
 // Vercel serverless: avoid hanging idle clients
 max: 1,
 idleTimeoutMillis: 10_000,
 connectionTimeoutMillis: 10_000,
 });
 _db = drizzle(_pool, { schema });
 return _db;
}

/** Lazy DB - only connects when first used (allows health checks without Postgres). */
export const db = new Proxy({} as Db, {
 get(_target, prop, receiver) {
 const instance = getDb();
 const value = Reflect.get(instance as object, prop, receiver);
 return typeof value === "function" ? value.bind(instance) : value;
 },
});

export const pool = new Proxy({} as pg.Pool, {
 get(_target, prop, receiver) {
 getDb();
 const value = Reflect.get(_pool as object, prop, receiver);
 return typeof value === "function" ? value.bind(_pool) : value;
 },
});

export * from "./schema";
