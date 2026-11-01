/**
 * Cloudflare Worker that serves licensed Bible translations to the site.
 *
 *   GET /v1/status                                  which providers have keys
 *   GET /v1/:provider/:edition/:BOOK/:chapter       normalized chapter JSON
 *
 * The worker holds the publisher API keys (as Worker secrets), accepts only
 * single-chapter requests, adds CORS for the docs origin, and never stores
 * text: responses are marked non-cacheable for the ESV (whose terms cap local
 * storage at 500 verses) and briefly browser-cacheable for the others.
 */
import { isKnownBook } from './books.ts';
import { apiBibleProvider } from './providers/api-bible.ts';
import { esvProvider } from './providers/esv.ts';
import { nltProvider } from './providers/nlt.ts';
import { ProviderError, type Provider, type ProviderEnv } from './types.ts';

const PROVIDERS: Record<string, Provider> = {
  [esvProvider.id]: esvProvider,
  [nltProvider.id]: nltProvider,
  [apiBibleProvider.id]: apiBibleProvider,
};

const ROUTE = /^\/v1\/([a-z-]+)\/([^/]+)\/([1-3]?[A-Za-z]{2,3})\/(\d{1,3})\/?$/;

export async function handleRequest(request: Request, env: ProviderEnv): Promise<Response> {
  const origin = request.headers.get('Origin');
  const cors = corsHeaders(env, origin);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed' }, 405, cors);

  const url = new URL(request.url);
  if (url.pathname === '/v1/status' || url.pathname === '/') {
    const providers: Record<string, boolean> = {};
    for (const provider of Object.values(PROVIDERS)) providers[provider.id] = provider.isConfigured(env);
    return json({ ok: true, providers }, 200, { ...cors, 'Cache-Control': 'no-store' });
  }

  const match = ROUTE.exec(url.pathname);
  if (!match) return json({ error: 'Not found. Use /v1/:provider/:edition/:BOOK/:chapter' }, 404, cors);
  const [, providerId = '', edition = '', book = '', chapterText = '0'] = match;
  const provider = PROVIDERS[providerId];
  if (!provider) return json({ error: `Unknown provider "${providerId}"` }, 404, cors);
  if (!provider.isConfigured(env)) return json({ error: `${providerId} is not configured on this proxy` }, 503, cors);
  if (!isKnownBook(book)) return json({ error: `Unknown book "${book}"` }, 404, cors);
  const chapter = Number(chapterText);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 150) return json({ error: 'Invalid chapter' }, 400, cors);

  try {
    const result = await provider.fetchChapter(env, decodeURIComponent(edition), book, chapter);
    const cacheControl = providerId === 'esv' ? 'no-store' : 'private, max-age=86400';
    return json(result, 200, { ...cors, 'Cache-Control': cacheControl });
  } catch (error: unknown) {
    if (error instanceof ProviderError) return json({ error: error.message }, error.status, { ...cors, 'Cache-Control': 'no-store' });
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return json({ error: message }, 502, { ...cors, 'Cache-Control': 'no-store' });
  }
}

function corsHeaders(env: ProviderEnv, origin: string | null): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? '*')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowed.includes('*')) headers['Access-Control-Allow-Origin'] = '*';
  else if (origin && allowed.some((pattern) => originMatches(pattern, origin))) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

/** Supports exact origins and `https://*.example.com` wildcards. */
function originMatches(pattern: string, origin: string): boolean {
  if (pattern === origin) return true;
  if (!pattern.includes('*')) return false;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+');
  return new RegExp(`^${escaped}$`).test(origin);
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

interface WorkerExport {
  fetch(request: Request, env: ProviderEnv): Promise<Response>;
}

const worker: WorkerExport = {
  fetch: (request, env) => handleRequest(request, env),
};

export default worker;
