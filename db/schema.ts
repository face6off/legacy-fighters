import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const multiplayerRooms = sqliteTable("multiplayer_rooms", {
  code: text("code").primaryKey(),
  hostTokenHash: text("host_token_hash").notNull(),
  guestTokenHash: text("guest_token_hash"),
  status: text("status").notNull().default("waiting"),
  hostFighter: text("host_fighter"),
  guestFighter: text("guest_fighter"),
  stageId: text("stage_id"),
  hostReady: integer("host_ready", { mode: "boolean" }).notNull().default(false),
  guestReady: integer("guest_ready", { mode: "boolean" }).notNull().default(false),
  hostInput: text("host_input").notNull().default("{}"),
  guestInput: text("guest_input").notNull().default("{}"),
  hostSequence: integer("host_sequence").notNull().default(0),
  guestSequence: integer("guest_sequence").notNull().default(0),
  snapshot: text("snapshot"),
  snapshotSequence: integer("snapshot_sequence").notNull().default(0),
  hostSeenAt: integer("host_seen_at").notNull(),
  guestSeenAt: integer("guest_seen_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
