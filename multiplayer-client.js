export function multiplayerApiBase(config = {}, location = globalThis.location || { protocol: 'https:' }) {
  const configured = String(config.multiplayerApiUrl || '').trim();
  if (!configured) {
    if (location.protocol === 'file:') throw new Error('Online play needs a configured multiplayer server.');
    return '';
  }
  const url = new URL(configured);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) {
    throw new Error('The multiplayer server must use HTTPS (HTTP is allowed for local development).');
  }
  return url.href.replace(/\/$/, '');
}

export async function multiplayerRequest(path, options = {}) {
  const base = multiplayerApiBase(window.LEGACY_FIGHTERS_CONFIG);
  const response = await fetch(`${base}/api/multiplayer/rooms${path}`, {
    ...options,
    credentials: 'omit',
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(() => ({ error: 'The multiplayer server is not configured or returned an invalid response.' }));
  if (!response.ok) throw new Error(data.error || 'The multiplayer room is unavailable.');
  return data;
}
