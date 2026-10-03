import { DurableObject } from 'cloudflare:workers';
import { createRoom } from '../app/api/multiplayer/rooms/route';
import { GET, POST } from '../app/api/multiplayer/rooms/[code]/route';
import { roomCode } from '../lib/multiplayer-room';
import { roomDatabase } from './database-context';
import schema from '../drizzle/0000_luxuriant_rhodey.sql';

const MAX_BODY_BYTES = 24000;
const LIFETIME_MS = 2 * 60 * 60 * 1000;

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function boundedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError('Request is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export default {
  async fetch(request: Request, env: any) {
    const origin = request.headers.get('Origin');
    const origins = new Set(String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
    if (origin && !origins.has(origin)) return json({ error: 'This game origin is not allowed.' }, 403);
    const cors = (response: Response) => {
      const headers = new Headers(response.headers);
      headers.set('Vary', 'Origin');
      headers.set('Cache-Control', 'no-store');
      if (origin) headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Room-Token');
      headers.set('Access-Control-Max-Age', '600');
      return new Response(response.body, { status: response.status, headers });
    };
    try {
      const path = new URL(request.url).pathname;
      if (path === '/health' && request.method === 'GET') return cors(json({ ok: true, version: '1.8.0' }));
      const match = path.match(/^\/api\/multiplayer\/rooms(?:\/([A-Z0-9]{6}))?\/?$/);
      if (!match) return cors(json({ error: 'Endpoint not found.' }, 404));
      if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
      if (!['GET', 'POST'].includes(request.method) || (!match[1] && request.method !== 'POST')) {
        const response = json({ error: 'Method not allowed.' }, 405);
        response.headers.set('Allow', match[1] ? 'GET, POST, OPTIONS' : 'POST, OPTIONS');
        return cors(response);
      }
      const body = request.method === 'POST' ? await boundedBody(request) : undefined;
      if (body && body.trim()) {
        try {
          const parsed = JSON.parse(body);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        } catch { return cors(json({ error: 'Send a valid JSON object.' }, 400)); }
      }
      const attempts = match[1] ? 1 : 8;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const code = match[1] || roomCode();
        const id = env.ROOMS.idFromName(code);
        const url = new URL(request.url);
        url.searchParams.set('room', code);
        const response = await env.ROOMS.get(id).fetch(new Request(url, {
          method: request.method, headers: request.headers, body: body || undefined,
        }));
        if (!match[1] && response.status === 409) continue;
        return cors(response);
      }
      return cors(json({ error: 'Could not create a room. Please try again.' }, 503));
    } catch (error) {
      if (error instanceof RangeError) return cors(json({ error: error.message }, 413));
      console.error('Multiplayer request failed', error);
      return cors(json({ error: 'The multiplayer service is temporarily unavailable.' }, 503));
    }
  },
};

export class MultiplayerRoom extends DurableObject {
  private database: any;

  constructor(ctx: any, env: any) {
    super(ctx, env);
    // This SQLite database lives with one room; game ticks never hit D1.
    ctx.storage.sql.exec(schema.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS '));
    this.database = {
      prepare: (query: string) => {
        let parameters: any[] = [];
        const statement = {
          bind: (...values: any[]) => { parameters = values; return statement; },
          first: async () => ctx.storage.sql.exec(query, ...parameters).toArray()[0] || null,
          run: async () => {
            const cursor = ctx.storage.sql.exec(query, ...parameters);
            return { success: true, meta: { changes: cursor.rowsWritten } };
          },
        };
        return statement;
      },
    };
  }

  async fetch(request: Request) {
    // Serialize state transitions, including token hashing, inside this room.
    return this.ctx.blockConcurrencyWhile(() => roomDatabase.run(this.database, async () => {
      const url = new URL(request.url);
      const code = url.searchParams.get('room')!;
      if (!/^[A-Z0-9]{6}$/.test(code || '')) return json({ error: 'Invalid room code.' }, 400);
      const creating = /\/rooms\/?$/.test(url.pathname);
      if (creating && this.ctx.storage.sql.exec('SELECT code FROM multiplayer_rooms LIMIT 1').toArray().length) {
        return json({ error: 'Room already exists.' }, 409);
      }
      const context = { params: Promise.resolve({ code }) };
      const response = creating ? await createRoom(() => code)
        : request.method === 'GET' ? await GET(request, context) : await POST(request, context);
      if (response.ok) await this.ctx.storage.setAlarm(Date.now() + LIFETIME_MS);
      return response;
    }));
  }

  async alarm() {
    this.ctx.storage.sql.exec('DELETE FROM multiplayer_rooms WHERE expires_at <= ?', Date.now());
    const room = this.ctx.storage.sql.exec('SELECT expires_at FROM multiplayer_rooms LIMIT 1').toArray()[0];
    if (room) await this.ctx.storage.setAlarm(Number(room.expires_at));
    else await this.ctx.storage.deleteAll();
  }
}
