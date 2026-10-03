import { env } from "cloudflare:workers";

export type RoomRole = "host" | "guest";

export type RoomRow = {
  code: string;
  host_token_hash: string;
  guest_token_hash: string | null;
  status: string;
  host_fighter: string | null;
  guest_fighter: string | null;
  stage_id: string | null;
  host_ready: number;
  guest_ready: number;
  host_input: string;
  guest_input: string;
  host_sequence: number;
  guest_sequence: number;
  snapshot: string | null;
  snapshot_sequence: number;
  host_seen_at: number;
  guest_seen_at: number | null;
  created_at: number;
  updated_at: number;
  expires_at: number;
};

export const FIGHTER_IDS = new Set([
  "duwane", "jean", "slater", "aden", "antonio", "brass", "buck",
  "shake", "danish", "con", "letsnot", "beib", "warrior", "kayess", "arenull", "paul",
]);

export const STAGE_IDS = new Set([
  "octagon", "toronto", "jungle", "fuji", "miami",
  "desert", "moon", "ring", "la", "paris",
]);

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_LIFETIME_MS = 2 * 60 * 60 * 1000;

export function db() {
  if (!env.DB) throw new Error("Multiplayer database unavailable");
  return env.DB;
}

export function roomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, value => ROOM_ALPHABET[value % ROOM_ALPHABET.length]).join("");
}

export function roomToken() {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

export async function hashToken(token: string) {
  const encoded = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function nowAndExpiry() {
  const now = Date.now();
  return { now, expiresAt: now + ROOM_LIFETIME_MS };
}

export async function loadRoom(code: string) {
  return db().prepare("SELECT * FROM multiplayer_rooms WHERE code = ? LIMIT 1")
    .bind(code)
    .first<RoomRow>();
}

export async function authorizeRoom(code: string, token: string) {
  const room = await loadRoom(code);
  if (!room || room.expires_at <= Date.now()) return null;
  const tokenHash = await hashToken(token);
  const role: RoomRole | null = tokenHash === room.host_token_hash
    ? "host"
    : tokenHash === room.guest_token_hash
      ? "guest"
      : null;
  return role ? { room, role } : null;
}

function parseJson(value: string | null) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export function publicRoom(room: RoomRow, role: RoomRole) {
  const now = Date.now();
  return {
    code: room.code,
    role,
    status: room.status,
    hostFighter: room.host_fighter,
    guestFighter: room.guest_fighter,
    stageId: room.stage_id,
    hostReady: Boolean(room.host_ready),
    guestReady: Boolean(room.guest_ready),
    hostConnected: now - room.host_seen_at < 8_000,
    guestConnected: Boolean(room.guest_seen_at && now - room.guest_seen_at < 8_000),
    hostInput: parseJson(room.host_input),
    guestInput: parseJson(room.guest_input),
    hostSequence: room.host_sequence,
    guestSequence: room.guest_sequence,
    snapshot: parseJson(room.snapshot),
    snapshotSequence: room.snapshot_sequence,
    updatedAt: room.updated_at,
  };
}

export function tokenFrom(request: Request) {
  return request.headers.get("x-room-token")?.trim() ?? "";
}

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function cleanCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export function cleanInput(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const attackActions = new Set(["shove", "jab", "cross", "kick", "heavyKick", "special"]);
  const attackAction = typeof input.attackAction === "string" && attackActions.has(input.attackAction)
    ? input.attackAction
    : null;
  return {
    left: input.left === true,
    right: input.right === true,
    block: input.block === true,
    attackAction,
    attackSequence: Math.max(0, Math.min(1_000_000_000, Number(input.attackSequence) || 0)),
  };
}
