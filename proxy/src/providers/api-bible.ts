/**
 * API.Bible (https://scripture.api.bible) by the American Bible Society.
 * Hosts NKJV, NASB, CSB, AMP, MSG, GNT, CEV and many more under per-translation
 * licenses. Requirements: copyright notice with every display, the Fair Use
 * Management System (FUMS) token reported from the browser, cached content
 * refreshed within 30 days, no more than 500 consecutive verses per display.
 *
 * Editions are given either as a bible id (e.g. `de4e12af7f28f599-02`) or as an
 * abbreviation (`NKJV`), resolved against the bibles available to the key.
 */
import { ProviderError, type LiveChapter, type LiveFootnote, type LiveItem, type LivePart, type Provider, type ProviderEnv } from '../types.ts';

const BASE = 'https://api.scripture.api.bible/v1';

interface BibleSummary {
  id: string;
  abbreviation: string;
  abbreviationLocal: string;
  name: string;
  language: string;
  copyright: string | undefined;
}

let bibleCache: { fetchedAt: number; bibles: BibleSummary[] } | undefined;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export const apiBibleProvider: Provider = {
  id: 'api-bible',
  isConfigured: (env) => Boolean(env.API_BIBLE_KEY),
  async fetchChapter(env, edition, book, chapter) {
    const key = env.API_BIBLE_KEY;
    if (!key) throw new ProviderError('API.Bible is not configured', 503);
    const bible = await resolveBible(env, key, edition);
    const url = `${BASE}/bibles/${encodeURIComponent(bible.id)}/chapters/${encodeURIComponent(`${book.toUpperCase()}.${chapter}`)}?content-type=json&include-notes=true&include-titles=true&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false`;
    const response = await fetch(url, { headers: { 'api-key': key, Accept: 'application/json' } });
    if (response.status === 404) throw new ProviderError(`${bible.abbreviation} has no ${book} ${chapter}`, 404);
    if (!response.ok) throw new ProviderError(`API.Bible responded ${response.status}`, response.status === 429 ? 429 : 502);
    const body: unknown = await response.json();
    const data = recordOf(recordOf(body)?.['data']);
    const meta = recordOf(recordOf(body)?.['meta']);
    if (!data) throw new ProviderError('API.Bible returned no data', 502);
    const parsed = parseContent(arrayOf(data['content']));
    const copyright = stringOf(data['copyright']) ?? bible.copyright;
    const result: LiveChapter = {
      provider: 'api-bible',
      edition: bible.abbreviation,
      book: book.toUpperCase(),
      chapter,
      content: parsed.content,
      footnotes: parsed.footnotes,
    };
    if (copyright) result.copyright = copyright.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const fums = stringOf(meta?.['fumsToken']);
    if (fums) result.fumsToken = fums;
    return result;
  },
};

// ---------------------------------------------------------------------------
// Edition resolution
// ---------------------------------------------------------------------------

function parseOverrides(env: ProviderEnv): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of (env.API_BIBLE_IDS ?? '').split(',')) {
    const [abbr, id] = pair.split('=').map((s) => s.trim());
    if (abbr && id) map.set(normalize(abbr), id);
  }
  return map;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function listBibles(key: string): Promise<BibleSummary[]> {
  if (bibleCache && Date.now() - bibleCache.fetchedAt < CACHE_TTL_MS) return bibleCache.bibles;
  const response = await fetch(`${BASE}/bibles`, { headers: { 'api-key': key, Accept: 'application/json' } });
  if (!response.ok) throw new ProviderError(`API.Bible bibles list responded ${response.status}`, 502);
  const body: unknown = await response.json();
  const bibles: BibleSummary[] = [];
  for (const entry of arrayOf(recordOf(body)?.['data'])) {
    const record = recordOf(entry);
    if (!record) continue;
    const id = stringOf(record['id']);
    if (!id) continue;
    bibles.push({
      id,
      abbreviation: stringOf(record['abbreviation']) ?? id,
      abbreviationLocal: stringOf(record['abbreviationLocal']) ?? '',
      name: stringOf(record['name']) ?? id,
      language: stringOf(recordOf(record['language'])?.['id']) ?? '',
      copyright: stringOf(record['copyright']),
    });
  }
  bibleCache = { fetchedAt: Date.now(), bibles };
  return bibles;
}

async function resolveBible(env: ProviderEnv, key: string, edition: string): Promise<BibleSummary> {
  const override = parseOverrides(env).get(normalize(edition));
  const bibles = await listBibles(key);
  if (override) {
    const match = bibles.find((b) => b.id === override);
    if (match) return match;
    return { id: override, abbreviation: edition, abbreviationLocal: edition, name: edition, language: '', copyright: undefined };
  }
  const byId = bibles.find((b) => b.id === edition);
  if (byId) return byId;
  const wanted = normalize(edition);
  const exact = bibles.filter((b) => normalize(b.abbreviation) === wanted || normalize(b.abbreviationLocal) === wanted);
  const match = exact.find((b) => b.language === 'eng') ?? exact[0];
  if (!match) {
    throw new ProviderError(
      `No API.Bible edition matches "${edition}" for this key. Add it to your API.Bible app, or set API_BIBLE_IDS="${edition}=<bibleId>".`,
      404,
    );
  }
  return match;
}

// ---------------------------------------------------------------------------
// Content parsing (API.Bible "json" content type)
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function recordOf(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

interface ContentState {
  content: LiveItem[];
  footnotes: LiveFootnote[];
  verse: Extract<LiveItem, { type: 'verse' }> | undefined;
  poem: number | undefined;
  verseHasText: boolean;
}

const HEADING_STYLES = new Set(['s', 's1', 's2', 's3', 'ms', 'ms1', 'ms2', 'mr', 'sr', 'r', 'sp', 'mt', 'mt1', 'mt2', 'qa']);
const SUBTITLE_STYLES = new Set(['d', 'cl', 'cd']);
const SKIP_STYLES = new Set(['c', 'ca', 'cp', 'toc1', 'toc2', 'toc3', 'h', 'ide', 'rem', 'ie', 'ib', 'b']);

function parseContent(paragraphs: unknown[]): { content: LiveItem[]; footnotes: LiveFootnote[] } {
  const state: ContentState = { content: [], footnotes: [], verse: undefined, poem: undefined, verseHasText: false };
  for (const entry of paragraphs) {
    const para = recordOf(entry);
    if (!para) continue;
    const style = stringOf(recordOf(para['attrs'])?.['style']) ?? 'p';
    const items = arrayOf(para['items']);
    if (SKIP_STYLES.has(style)) continue;
    if (HEADING_STYLES.has(style) || SUBTITLE_STYLES.has(style)) {
      const text = collectText(items).replace(/\s+/g, ' ').trim();
      if (text) state.content.push(HEADING_STYLES.has(style) ? { type: 'heading', text } : { type: 'subtitle', text });
      continue;
    }
    const poetry = /^q(\d)?$/.exec(style);
    const level = poetry ? Number(poetry[1] ?? '1') : undefined;
    // A new paragraph: break inside an open verse, or between verses.
    if (state.verse && state.verseHasText) pushPart(state, { lineBreak: true });
    else if (!state.verse && state.content.length > 0 && level === undefined) state.content.push({ type: 'line_break' });
    else if (!state.verse && state.content.length > 0 && level === 1) state.content.push({ type: 'line_break' });
    state.poem = level;
    walkItems(state, items, false);
  }
  flushVerse(state);
  return { content: state.content, footnotes: state.footnotes };
}

function collectText(items: unknown[]): string {
  let out = '';
  for (const entry of items) {
    const item = recordOf(entry);
    if (!item) continue;
    if (item['type'] === 'text') out += stringOf(item['text']) ?? '';
    else if (item['name'] !== 'note' && item['name'] !== 'verse') out += collectText(arrayOf(item['items']));
  }
  return out;
}

function walkItems(state: ContentState, items: unknown[], wordsOfJesus: boolean): void {
  for (const entry of items) {
    const item = recordOf(entry);
    if (!item) continue;
    const type = stringOf(item['type']);
    const name = stringOf(item['name']);
    const attrs = recordOf(item['attrs']) ?? {};
    if (type === 'text') {
      const text = (stringOf(item['text']) ?? '').replace(/\s+/g, ' ');
      if (text.trim().length === 0) continue;
      if (!state.verse) continue;
      if (state.poem !== undefined || wordsOfJesus) {
        const part: Extract<LivePart, { text: string }> = { text };
        if (state.poem !== undefined) part.poem = state.poem;
        if (wordsOfJesus) part.wordsOfJesus = true;
        pushPart(state, part);
      } else {
        pushPart(state, text);
      }
      state.verseHasText = true;
      continue;
    }
    if (name === 'verse') {
      const number = Number(stringOf(attrs['number']) ?? '0');
      if (number > 0) {
        flushVerse(state);
        state.verse = { type: 'verse', number, parts: [] };
        state.verseHasText = false;
      }
      continue;
    }
    if (name === 'note') {
      const text = collectNote(arrayOf(item['items']));
      if (text && state.verse) {
        const noteId = state.footnotes.length;
        state.footnotes.push({ noteId, text });
        pushPart(state, { noteId });
      }
      continue;
    }
    const style = stringOf(attrs['style']) ?? '';
    const red = wordsOfJesus || style === 'wj';
    walkItems(state, arrayOf(item['items']), red);
  }
}

function collectNote(items: unknown[]): string {
  let out = '';
  for (const entry of items) {
    const item = recordOf(entry);
    if (!item) continue;
    const style = stringOf(recordOf(item['attrs'])?.['style']) ?? '';
    if (item['type'] === 'text') out += stringOf(item['text']) ?? '';
    else if (style === 'fr') out += `${collectText(arrayOf(item['items'])).trim()} `;
    else out += collectText(arrayOf(item['items']));
  }
  return out.replace(/\s+/g, ' ').trim();
}

function pushPart(state: ContentState, part: LivePart): void {
  if (!state.verse) return;
  const parts = state.verse.parts;
  const last = parts[parts.length - 1];
  if (typeof part === 'string' && typeof last === 'string') {
    parts[parts.length - 1] = last + part;
    return;
  }
  if (isText(part) && isText(last) && last.poem === part.poem && Boolean(last.wordsOfJesus) === Boolean(part.wordsOfJesus)) {
    last.text += part.text;
    return;
  }
  const isBreak = typeof part === 'object' && 'lineBreak' in part;
  const lastIsBreak = typeof last === 'object' && last !== null && 'lineBreak' in last;
  if (isBreak && (lastIsBreak || parts.length === 0)) return;
  parts.push(part);
}

function isText(part: LivePart | undefined): part is Extract<LivePart, { text: string }> {
  return typeof part === 'object' && part !== null && 'text' in part;
}

function flushVerse(state: ContentState): void {
  if (!state.verse) return;
  const parts = state.verse.parts;
  const first = parts[0];
  if (typeof first === 'string') parts[0] = first.replace(/^\s+/, '');
  const last = parts[parts.length - 1];
  if (typeof last === 'string') parts[parts.length - 1] = last.replace(/\s+$/, '');
  if (parts.length > 0) state.content.push(state.verse);
  state.verse = undefined;
  state.verseHasText = false;
}
