import {
  FIGHTER_IDS,
  STAGE_IDS,
  authorizeRoom,
  cleanCode,
  cleanInput,
  db,
  hashToken,
  json,
  loadRoom,
  nowAndExpiry,
  publicRoom,
  roomToken,
  tokenFrom,
} from "@/lib/multiplayer-room";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ code: string }> };

export async function GET(request: Request, context: Context) {
  const code = cleanCode((await context.params).code);
  const auth = await authorizeRoom(code, tokenFrom(request));
  if (!auth) return json({ error: "Room not found or access expired." }, 404);
  const { room, role } = auth;
  const { now, expiresAt } = nowAndExpiry();
  const seenColumn = role === "host" ? "host_seen_at" : "guest_seen_at";
  const lastSeen = role === "host" ? room.host_seen_at : room.guest_seen_at ?? 0;

  // Lobby polling is the connection heartbeat. Throttle the database write while
  // still treating the authenticated browser as connected in this response.
  if (now - lastSeen >= 2_000) {
    await db().prepare(`
      UPDATE multiplayer_rooms
      SET ${seenColumn} = ?, expires_at = ?
      WHERE code = ?
    `).bind(now, expiresAt, code).run();
  }

  const liveRoom = role === "host"
    ? { ...room, host_seen_at: now, expires_at: expiresAt }
    : { ...room, guest_seen_at: now, expires_at: expiresAt };
  return json({ room: publicRoom(liveRoom, role) });
}

export async function POST(request: Request, context: Context) {
  const code = cleanCode((await context.params).code);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "join") {
    const existing = await loadRoom(code);
    if (!existing || existing.expires_at <= Date.now()) return json({ error: "Room not found or expired." }, 404);
    if (existing.guest_token_hash) return json({ error: "This room already has two fighters." }, 409);

    const token = roomToken();
    const tokenHash = await hashToken(token);
    const { now, expiresAt } = nowAndExpiry();
    const joined = await db().prepare(`
      UPDATE multiplayer_rooms
      SET guest_token_hash = ?, status = 'selecting', guest_seen_at = ?, updated_at = ?, expires_at = ?
      WHERE code = ? AND guest_token_hash IS NULL AND expires_at > ?
    `).bind(tokenHash, now, now, expiresAt, code, now).run();
    if (!joined.meta.changes) return json({ error: "This room is no longer available." }, 409);
    const room = await loadRoom(code);
    return json({ token, room: publicRoom(room!, "guest") });
  }

  const auth = await authorizeRoom(code, tokenFrom(request));
  if (!auth) return json({ error: "Room not found or access expired." }, 404);
  const { room, role } = auth;
  const { now, expiresAt } = nowAndExpiry();

  if (action === "selection") {
    const fighter = typeof body.fighter === "string" ? body.fighter : "";
    if (!FIGHTER_IDS.has(fighter)) return json({ error: "Choose a valid fighter." }, 400);
    const fighterColumn = role === "host" ? "host_fighter" : "guest_fighter";
    const readyColumn = role === "host" ? "host_ready" : "guest_ready";
    const seenColumn = role === "host" ? "host_seen_at" : "guest_seen_at";
    await db().prepare(`
      UPDATE multiplayer_rooms
      SET ${fighterColumn} = ?, ${readyColumn} = 1, ${seenColumn} = ?, status = 'selecting', updated_at = ?, expires_at = ?
      WHERE code = ?
    `).bind(fighter, now, now, expiresAt, code).run();
  } else if (action === "start") {
    if (role !== "host") return json({ error: "Only the room host can start the fight." }, 403);
    const stageId = typeof body.stageId === "string" ? body.stageId : "";
    if (!STAGE_IDS.has(stageId)) return json({ error: "Choose a valid arena." }, 400);
    if (!room.host_ready || !room.guest_ready || !room.host_fighter || !room.guest_fighter) {
      return json({ error: "Both fighters must lock in first." }, 409);
    }
    await db().prepare(`
      UPDATE multiplayer_rooms
      SET stage_id = ?, status = 'fighting', snapshot = NULL, snapshot_sequence = 0,
          host_input = '{}', guest_input = '{}', host_sequence = 0, guest_sequence = 0,
          host_seen_at = ?, updated_at = ?, expires_at = ?
      WHERE code = ?
    `).bind(stageId, now, now, expiresAt, code).run();
  } else if (action === "sync") {
    const input = cleanInput(body.input);
    const inputJson = JSON.stringify(input);
    const sequence = Math.max(0, Math.min(1_000_000_000, Number(body.sequence) || 0));
    if (role === "host") {
      const snapshotText = body.snapshot == null ? room.snapshot : JSON.stringify(body.snapshot);
      if (snapshotText && snapshotText.length > 16_000) return json({ error: "Network snapshot is too large." }, 413);
      const snapshotSequence = Math.max(room.snapshot_sequence, Math.min(1_000_000_000, Number(body.snapshotSequence) || 0));
      const ended = Boolean(body.snapshot && typeof body.snapshot === "object" && (body.snapshot as Record<string, unknown>).ended);
      await db().prepare(`
        UPDATE multiplayer_rooms
        SET host_input = ?, host_sequence = ?, snapshot = ?, snapshot_sequence = ?,
            status = ?, host_seen_at = ?, updated_at = ?, expires_at = ?
        WHERE code = ?
      `).bind(inputJson, sequence, snapshotText, snapshotSequence, ended ? "finished" : room.status, now, now, expiresAt, code).run();
    } else {
      await db().prepare(`
        UPDATE multiplayer_rooms
        SET guest_input = ?, guest_sequence = ?, guest_seen_at = ?, updated_at = ?, expires_at = ?
        WHERE code = ?
      `).bind(inputJson, sequence, now, now, expiresAt, code).run();
    }
  } else if (action === "reset") {
    await db().prepare(`
      UPDATE multiplayer_rooms
      SET status = 'selecting', host_fighter = NULL, guest_fighter = NULL, stage_id = NULL,
          host_ready = 0, guest_ready = 0, host_input = '{}', guest_input = '{}',
          host_sequence = 0, guest_sequence = 0, snapshot = NULL, snapshot_sequence = 0,
          updated_at = ?, expires_at = ?
      WHERE code = ?
    `).bind(now, expiresAt, code).run();
  } else if (action === "leave") {
    if (role === "host") {
      await db().prepare("DELETE FROM multiplayer_rooms WHERE code = ?").bind(code).run();
      return json({ left: true });
    }
    await db().prepare(`
      UPDATE multiplayer_rooms
      SET guest_token_hash = NULL, guest_fighter = NULL, guest_ready = 0, guest_seen_at = NULL,
          guest_input = '{}', guest_sequence = 0, status = 'waiting', snapshot = NULL,
          snapshot_sequence = 0, updated_at = ?, expires_at = ?
      WHERE code = ?
    `).bind(now, expiresAt, code).run();
    return json({ left: true });
  } else {
    return json({ error: "Unknown room action." }, 400);
  }

  const updated = await loadRoom(code);
  return json({ room: publicRoom(updated!, role) });
}
