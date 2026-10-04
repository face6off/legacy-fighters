# Legacy Fighters

Legacy Fighters is an original browser fighting game with arcade combat, career progression, local modes, and online multiplayer support.

## Current version

Version 1.81 connects the source and downloadable editions to the shared online arena. Version 1.8 adds a standalone Cloudflare multiplayer service for static-hosted editions.

## Run locally

From the repository root:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

The browser-only modes run from the static files. Online multiplayer requires the separately deployed Cloudflare Worker described below. Downloading the HTML alone does not include its JavaScript, artwork, or audio; preserve the static edition's full folder.

## Multiplayer development

Use Node.js 24 and Python 3. Install the pinned tools with `npm ci`, then run `npm run dev:api` and `npm run dev` in separate terminals. For local testing, override `multiplayerApiUrl` in the browser or an untracked static copy to `http://127.0.0.1:8787` for local play. Both browsers must use the same API URL. The tracked configuration uses the public Worker URL; the release workflow generates the configured file in its static artifact.

Run `npm test` to exercise the real Cloudflare local runtime: room lifecycle, concurrent joins, role/token authorization, CORS, input/snapshot synchronization, stale requests, rematches, room isolation and request validation. `npm run check:worker` builds the deployment bundle without publishing it.

With both servers running, `npm run test:browser` exercises two-player gameplay, browser reload recovery, completed-match recovery, rematches, and classic pause/resume. Install Chromium with `npx playwright install chromium`, or set `CHROMIUM_PATH` to an installed Chromium binary (in this cloud environment, `/usr/bin/chromium`). This test injects the local API URL without editing your client configuration.

## Deploy to Cloudflare and GitHub Pages

1. Create a [Cloudflare account](https://dash.cloudflare.com/sign-up), activate Workers, and choose a workers.dev subdomain. This service uses SQLite Durable Objects; no D1 database or migration command is needed. Confirm the current Workers/Durable Objects plan limits in your account before public use.
2. Create an API token using Cloudflare's **Edit Cloudflare Workers** template, scoped to your account. In this GitHub repository's Settings → Secrets and variables → Actions, add the secret `CLOUDFLARE_API_TOKEN` and the repository variable `CLOUDFLARE_ACCOUNT_ID`. Never put the token into the game's JavaScript or commit it.
3. In Settings → Pages, select **GitHub Actions** as the source. Run **Verify and publish** from the Actions tab. It deploys the Worker, checks its health, packages the static edition with the returned HTTPS API URL, and publishes GitHub Pages. Deployment is skipped while the account ID variable is absent; tests still run. Adding credentials later does not rerun an old job: run the workflow again.
4. Open the published game in two browsers, create a room in one, join using its code in the other, select fighters and start a match. Both players must connect to the same deployed API.

For manual Cloudflare deployment, set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` securely in your shell or cloud environment, then run `npm run deploy:api`. Set `MULTIPLAYER_API_URL` to the HTTPS URL Wrangler returns and run `node scripts/package-site.mjs`. Publish **only `dist/site`** to your static host. Alternatively, put that public URL in `multiplayer-config.js` before serving the original files. No credentials belong in client configuration.

`ALLOWED_ORIGINS` in `wrangler.jsonc` permits `https://face6off.github.io` and the two local development origins. For another domain, include its exact origin and redeploy. Repository path names do not belong in an origin. An HTML file opened directly from disk sends a `null` origin; serve it over HTTP/HTTPS instead. The existing same-origin D1 routes remain usable, but the Worker uses one isolated Durable Object per room to avoid D1 writes on every game tick.

Rooms expire after two hours without activity and are cleaned up by alarms. Tokens identify the two players and are scoped to one room; there are no accounts or public room listings. Combat remains host-authoritative, so the host controls match simulation. This release retains HTTP polling; it is not a competitive anti-cheat or WebSocket server. Monitor Cloudflare request/storage limits before promoting the game widely.

## Releases

Keep future updates in `face6off/legacy-fighters`; do not create a repository per version. Update the package version and game update log, validate the API and browser gameplay, and publish a GitHub release with a matching tag (for example `v1.8.0`). Version-tag pushes trigger the release workflow after Cloudflare and Pages are configured. Live multiplayer is available only after that deployment succeeds; a GitHub source release alone does not start a server. Preserve historical release tags.

## Main files

- `index.html` — game entry point
- `styles.css` — interface and arena styling
- `game.js` — combat, menus, audio, and multiplayer client
- `game-data.js` — characters, stages, and shared game data
- `legacy-mode.js` — Start Your Legacy mode
- `career-mode.js` — career mode logic
- `assets/` — game logo, stage artwork, and soundtrack files
- `app/api/multiplayer/` — multiplayer room API source
- `lib/multiplayer-room.ts` — multiplayer room synchronization
- `db/` and `drizzle/` — database schema and migrations
- `server/worker.ts` — Cloudflare router and per-room Durable Object storage
- `multiplayer-config.js` — public multiplayer API URL for the static client
- `wrangler.jsonc` — Cloudflare deployment and origin configuration

## Notes

Large media files are included because they are used directly by the game. Keep rights and distribution permissions in mind when adding new soundtrack material.
