const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// Start the static and API servers before running this smoke test.
const site = process.env.STATIC_GAME_URL || 'http://127.0.0.1:8080';
const api = process.env.MULTIPLAYER_API_URL || 'http://127.0.0.1:8787';

(async () => {
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    headless: true,
  });
  const errors = [], failed = [];
  try {
    const pages = [];
    for (let index = 0; index < 2; index++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        if ((response.url().startsWith(site) || response.url().startsWith(api)) && response.status() >= 400) failed.push(response.status());
      });
      // Configure the real API, without changing the tracked config file.
      await page.route('**/multiplayer-config.js*', route => route.fulfill({
        contentType: 'application/javascript',
        body: `window.LEGACY_FIGHTERS_CONFIG=${JSON.stringify({ multiplayerApiUrl: api })};`,
      }));
      await page.goto(site);
      pages.push(page);
    }
    async function enterMultiplayer(page) {
      await page.click('#enterGameBtn');
      await page.click('#playBtn');
      await page.click('[data-mode="multiplayer"]');
    }
    const [host, guest] = pages;
    await enterMultiplayer(host);
    await enterMultiplayer(guest);
    await host.click('#createRoomBtn');
    await host.waitForFunction(() => /^[A-Z0-9]{6}$/.test(document.querySelector('#roomCodeDisplay').textContent));
    const code = await host.locator('#roomCodeDisplay').innerText();
    await guest.fill('#joinCodeInput', code);
    await guest.click('#joinRoomBtn');
    await host.click('#multiplayerPrimaryBtn');
    await host.click('#fightBtn');
    await guest.click('#multiplayerPrimaryBtn');
    await guest.click('#fightBtn');
    await host.click('#stageFightBtn');
    for (const page of pages) await page.locator('#gameScreen').waitFor({ state: 'visible' });
    await guest.keyboard.down('a');
    await guest.waitForTimeout(500);
    await guest.keyboard.up('a');
    await guest.keyboard.press('f');
    for (const page of pages) {
      await page.waitForFunction(() => document.querySelector('#networkStatus').textContent.includes('SYNCHRONIZED'));
      assert.ok(await page.evaluate(() => document.querySelector('#game').getContext('2d').getImageData(0, 0, 1280, 720).data.some(value => value !== 0)));
    }
    await host.reload();
    await enterMultiplayer(host);
    await host.locator('#gameScreen').waitFor({ state: 'visible' });
    await host.waitForFunction(() => document.querySelector('#networkStatus').textContent.includes('SYNCHRONIZED'));
    await guest.reload();
    await enterMultiplayer(guest);
    await guest.locator('#gameScreen').waitFor({ state: 'visible' });
    await guest.waitForFunction(() => document.querySelector('#networkStatus').textContent.includes('SYNCHRONIZED'));

    // Stop host simulation and finish through the authenticated real API to
    // exercise finished-room restoration without waiting a whole round.
    const session = await host.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('legacyFightersMultiplayerRoom:')))));
    await host.reload();
    const stateResponse = await host.request.get(`${api}/api/multiplayer/rooms/${code}`, { headers: { 'x-room-token': session.token } });
    const { room } = await stateResponse.json();
    const finalResponse = await host.request.post(`${api}/api/multiplayer/rooms/${code}`, {
      headers: { 'x-room-token': session.token },
      data: { action: 'sync', sequence: room.hostSequence + 1, snapshotSequence: room.snapshotSequence + 1, snapshot: { ...room.snapshot, ended: true, winner: 'host' } },
    });
    assert.equal(finalResponse.status(), 200);
    await enterMultiplayer(host);
    for (const page of pages) await page.locator('#resultDialog').waitFor({ state: 'visible' });
    await guest.click('#rematchBtn');
    for (const page of pages) await page.waitForFunction(() => !document.querySelector('#resultDialog').open && !document.querySelector('#multiplayerScreen').classList.contains('hidden'));
    assert.deepEqual(errors, []);
    assert.deepEqual(failed, []);
    await host.click('#leaveRoomBtn');
    await host.click('#modeBackBtn');
    await host.click('#playBtn');
    await host.click('[data-mode="classic"]');
    await host.click('#fightBtn');
    await host.click('#stageFightBtn');
    await host.click('#pauseBtn');
    assert.ok(await host.locator('#pauseMenu').isVisible());
    await host.click('#resumeGameBtn');
    assert.deepEqual(errors, []);
    // Leaving deletes the room; the remaining guest's poll may legitimately
    // receive 404. Assert all unexpected failures before teardown separately.
    assert.ok(failed.every(status => status === 404), JSON.stringify(failed));
    console.log('Browser smoke passed: two-player gameplay, host/guest reconnect, finished-room recovery, rematch and classic pause/resume.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
