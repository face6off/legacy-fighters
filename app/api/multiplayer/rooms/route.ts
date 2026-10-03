import {
  db,
  hashToken,
  json,
  nowAndExpiry,
  publicRoom,
  roomCode,
  roomToken,
  type RoomRow,
} from "@/lib/multiplayer-room";

export const dynamic = "force-dynamic";

export async function POST() {
  const token = roomToken();
  const tokenHash = await hashToken(token);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = roomCode();
    const { now, expiresAt } = nowAndExpiry();
    try {
      await db().prepare(`
        INSERT INTO multiplayer_rooms (
          code, host_token_hash, status, host_input, guest_input,
          host_sequence, guest_sequence, snapshot_sequence,
          host_seen_at, created_at, updated_at, expires_at
        ) VALUES (?, ?, 'waiting', '{}', '{}', 0, 0, 0, ?, ?, ?, ?)
      `).bind(code, tokenHash, now, now, now, expiresAt).run();
      const room = await db().prepare("SELECT * FROM multiplayer_rooms WHERE code = ? LIMIT 1")
        .bind(code)
        .first<RoomRow>();
      return json({ token, room: publicRoom(room!, "host") }, 201);
    } catch (error) {
      if (attempt === 7) {
        console.error("Failed to create multiplayer room", error);
        return json({ error: "Could not create a room. Please try again." }, 503);
      }
    }
  }

  return json({ error: "Could not create a room. Please try again." }, 503);
}
