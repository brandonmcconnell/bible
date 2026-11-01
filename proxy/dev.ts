/**
 * Runs the worker locally on Node without Wrangler:
 *
 *   ESV_API_KEY=… NLT_API_KEY=… API_BIBLE_KEY=… npm run dev
 *
 * Keys are read from the environment; missing providers report 503.
 */
import { createServer } from 'node:http';
import { handleRequest } from './src/index.ts';
import type { ProviderEnv } from './src/types.ts';

const port = Number(process.env['PORT'] ?? '8787');
const env: ProviderEnv = {};
if (process.env['ESV_API_KEY']) env.ESV_API_KEY = process.env['ESV_API_KEY'];
if (process.env['NLT_API_KEY']) env.NLT_API_KEY = process.env['NLT_API_KEY'];
if (process.env['API_BIBLE_KEY']) env.API_BIBLE_KEY = process.env['API_BIBLE_KEY'];
if (process.env['API_BIBLE_IDS']) env.API_BIBLE_IDS = process.env['API_BIBLE_IDS'];
if (process.env['ALLOWED_ORIGINS']) env.ALLOWED_ORIGINS = process.env['ALLOWED_ORIGINS'];

const server = createServer(async (req, res) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  }
  const request = new Request(`http://localhost:${port}${req.url ?? '/'}`, { method: req.method ?? 'GET', headers });
  const response = await handleRequest(request, env);
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(port, () => {
  process.stdout.write(`bible proxy listening on http://localhost:${port}\n`);
});
