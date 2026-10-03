import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { multiplayerApiBase } from '../multiplayer-client.js';

const apiUrl = multiplayerApiBase({ multiplayerApiUrl: process.env.MULTIPLAYER_API_URL });
if (!apiUrl || !apiUrl.startsWith('https://')) throw new Error('Set MULTIPLAYER_API_URL to the deployed HTTPS multiplayer server before publishing.');
const destination = 'dist/site';
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const name of ['index.html', 'styles.css', 'favicon.svg', 'game.js', 'game-data.js', 'career-mode.js', 'legacy-mode.js', 'multiplayer-client.js', 'assets']) {
  await cp(name, `${destination}/${name}`, { recursive: true, filter: path => !path.split(/[\\/]/).some(part => part.toLowerCase().includes('.openai')) });
}
await writeFile(`${destination}/multiplayer-config.js`, `window.LEGACY_FIGHTERS_CONFIG = Object.freeze(${JSON.stringify({ multiplayerApiUrl: apiUrl })});\n`);
await writeFile(`${destination}/.nojekyll`, '');
console.log(`Static edition prepared for version ${JSON.parse(await readFile('package.json', 'utf8')).version}.`);
