import { readFile, appendFile } from 'node:fs/promises';

const log = await readFile(process.argv[2], 'utf8');
const url = log.match(/https:\/\/legacy-fighters-multiplayer\.[a-z0-9-]+\.workers\.dev\b/i)?.[0];
if (!url) throw new Error('Deployment did not report a public Worker URL; check the Cloudflare workers.dev subdomain.');
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `url=${url}\n`);
else console.log(url);
