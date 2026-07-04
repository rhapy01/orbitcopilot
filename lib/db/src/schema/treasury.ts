import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** Optional persisted treasury address for Orbit-native markets. */
export const orbitConfigTable = pgTable("orbit_config", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
