# Legacy Fighters

Legacy Fighters is an original browser fighting game with arcade combat, career progression, local modes, and online multiplayer support.

## Current version

Version 1.7 is in active development.

## Run locally

From the repository root:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

The browser-only modes run from the static files. Online multiplayer also requires the room API and its database.

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

## Notes

Large media files are included because they are used directly by the game. Keep rights and distribution permissions in mind when adding new soundtrack material.
