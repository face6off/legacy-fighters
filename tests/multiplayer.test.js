import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { multiplayerApiBase } from '../multiplayer-client.js';

const base = 'http://127.0.0.1:8791';
let worker, temporary, log = '';
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'legacy-fighters-tests-'));
  worker = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--ip', '127.0.0.1', '--port', '8791', '--persist-to', join(temporary, 'state')], {
    env: { ...process.env, XDG_CONFIG_HOME: temporary, XDG_CACHE_HOME: temporary, WRANGLER_SEND_METRICS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [worker.stdout, worker.stderr]) stream.on('data', value => { log = (log + value).slice(-12000); });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch {}
    if (worker.exitCode !== null) throw new Error(log);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Worker readiness failed: ${log}`);
});
after(async () => {
  if (worker && worker.exitCode === null) {
    const closed = new Promise(resolve => worker.once('exit', resolve));
    worker.kill('SIGTERM');
    await closed;
  }
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

async function call(path = '', { token, body, method = 'POST', origin = 'http://127.0.0.1:8080' } = {}) {
  const response = await fetch(`${base}/api/multiplayer/rooms${path}`, {
    method, headers: { Origin: origin, ...(token ? { 'x-room-token': token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, headers: response.headers, data: await response.json() };
}

test('static API URL accepts HTTPS and local development, rejects insecure remote URLs', () => {
  assert.equal(multiplayerApiBase({ multiplayerApiUrl: 'https://game.example.com/' }), 'https://game.example.com');
  assert.equal(multiplayerApiBase({ multiplayerApiUrl: 'http://localhost:8787' }), 'http://localhost:8787');
  assert.equal(multiplayerApiBase({}, { protocol: 'https:' }), '');
  assert.throws(() => multiplayerApiBase({}, { protocol: 'file:' }));
  for (const url of ['http://game.example.com', 'https://user:pass@game.example.com', 'javascript:alert(1)', 'https://game.example.com/?token=x']) {
    assert.throws(() => multiplayerApiBase({ multiplayerApiUrl: url }));
  }
});

test('cross-origin preflight and route protections', async () => {
  const response = await fetch(`${base}/api/multiplayer/rooms`, { method: 'OPTIONS', headers: { Origin: 'https://face6off.github.io', 'Access-Control-Request-Headers': 'content-type,x-room-token' } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://face6off.github.io');
  assert.match(response.headers.get('access-control-allow-headers'), /X-Room-Token/);
  assert.equal((await call('', { origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await call('', { method: 'GET' })).status, 405);
  assert.equal((await call('/ABCDEF', { method: 'GET' })).status, 404);
  assert.equal((await fetch(`${base}/api/multiplayer/rooms`, { method: 'POST', body: '{' })).status, 400);
  assert.equal((await fetch(`${base}/api/multiplayer/rooms`, { method: 'POST', body: JSON.stringify({ large: 'x'.repeat(25000) }) })).status, 413);
});

test('two-player room lifecycle, authentication, concurrent joins, sync, rematch and leave', async () => {
  const created = await call();
  assert.equal(created.status, 201);
  assert.equal(created.data.room.role, 'host');
  const path = `/${created.data.room.code}`, host = created.data.token;
  assert.equal((await call(path, { method: 'GET', token: 'wrong' })).status, 404);
  const joins = await Promise.all([call(path, { body: { action: 'join' } }), call(path, { body: { action: 'join' } })]);
  assert.deepEqual(joins.map(result => result.status).sort(), [200, 409]);
  const guest = joins.find(result => result.status === 200).data.token;
  assert.notEqual(host, guest);
  assert.equal((await call(path, { token: guest, body: { action: 'start', stageId: 'octagon' } })).status, 403);
  assert.equal((await call(path, { token: host, body: { action: 'start', stageId: 'octagon' } })).status, 409);
  assert.equal((await call(path, { token: host, body: { action: 'selection', fighter: 'unknown' } })).status, 400);
  for (const [token, fighter] of [[host, 'duwane'], [guest, 'jean']]) {
    assert.equal((await call(path, { token, body: { action: 'selection', fighter } })).status, 200);
  }
  assert.equal((await call(path, { token: host, body: { action: 'start', stageId: 'octagon' } })).data.room.status, 'fighting');
  assert.equal((await call(path, { token: guest, body: { action: 'reset' } })).status, 409);
  const fighter = { x: 310, vx: 0, health: 100, maxHealth: 100, stamina: 100, maxStamina: 100, meter: 0, state: 'idle', stateTime: 0 };
  const snapshot = { player: fighter, cpu: { ...fighter, x: 970 }, timer: 58, startDelay: 0, ended: false, winner: null };
  assert.equal((await call(path, { token: host, body: { action: 'sync', sequence: 1, snapshot: {}, snapshotSequence: 1 } })).status, 400);
  const update = await call(path, { token: host, body: { action: 'sync', sequence: 1, snapshot, snapshotSequence: 1 } });
  assert.equal(update.status, 200);
  const guestUpdate = await call(path, { token: guest, body: { action: 'sync', sequence: 2, input: { right: true, attackAction: 'jab', attackSequence: 1 } } });
  assert.equal(guestUpdate.data.room.snapshot.player.x, 310);
  assert.equal(guestUpdate.data.room.snapshotSequence, 1);
  await call(path, { token: guest, body: { action: 'sync', sequence: 1, input: { left: true } } });
  const state = await call(path, { token: host, method: 'GET' });
  assert.equal(state.data.room.guestSequence, 2);
  assert.equal(state.data.room.guestInput.right, true);
  const finished = await call(path, { token: host, body: { action: 'sync', sequence: 2, snapshot: { ...snapshot, ended: true, winner: 'host' }, snapshotSequence: 2 } });
  assert.equal(finished.data.room.status, 'finished');
  assert.equal((await call(path, { token: guest, body: { action: 'reset' } })).data.room.status, 'selecting');
  await call(path, { token: guest, body: { action: 'leave' } });
  assert.equal((await call(path, { token: guest, method: 'GET' })).status, 404);
  assert.equal((await call(path, { token: host, method: 'GET' })).data.room.status, 'waiting');
  const rejoin = await call(path, { body: { action: 'join' } });
  assert.equal(rejoin.status, 200);
  assert.notEqual(rejoin.data.token, guest);
  await call(path, { token: host, body: { action: 'leave' } });
  assert.equal((await call(path, { token: rejoin.data.token, method: 'GET' })).status, 404);
});

test('room data is isolated between Durable Objects', async () => {
  const first = (await call()).data, second = (await call()).data;
  assert.notEqual(first.room.code, second.room.code);
  assert.equal((await call(`/${second.room.code}`, { token: first.token, method: 'GET' })).status, 404);
  assert.equal((await call(`/${first.room.code}`, { token: first.token, method: 'GET' })).status, 200);
  await call(`/${first.room.code}`, { token: first.token, body: { action: 'leave' } });
  await call(`/${second.room.code}`, { token: second.token, body: { action: 'leave' } });
});
