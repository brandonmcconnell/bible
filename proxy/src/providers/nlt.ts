/**
 * NLT via Tyndale's API (https://api.nlt.to). Non-commercial use; register a
 * key for 500 verses/request and 5,000 requests/day. Also serves the NLT UK
 * edition (`NLTUK`) and the Spanish Nueva Traducción Viviente (`NTV`).
 */
import { bookNames } from '../books.ts';
import { hasClass, tokenize, type Token } from '../html.ts';
import { ProviderError, type LiveChapter, type LiveFootnote, type LiveItem, type LivePart, type Provider, type ProviderEnv } from '../types.ts';

const ENDPOINT = 'https://api.nlt.to/api/passages';
const EDITIONS = new Set(['NLT', 'NLTUK', 'NTV']);

const COPYRIGHT =
  'Scripture quotations marked (NLT) are taken from the Holy Bible, New Living Translation, copyright © 1996, 2004, 2015 by Tyndale House Foundation. Used by permission of Tyndale House Publishers, Carol Stream, Illinois 60188. All rights reserved.';

export const nltProvider: Provider = {
  id: 'nlt',
  // Tyndale allows anonymous use with lower limits, so the provider is always usable.
  isConfigured: () => true,
  async fetchChapter(env, edition, book, chapter) {
    const version = edition.toUpperCase();
    if (!EDITIONS.has(version)) throw new ProviderError(`Unknown NLT edition ${edition}`, 404);
    const names = bookNames(book);
    if (!names) throw new ProviderError(`Unknown book ${book}`, 404);

    const params = new URLSearchParams({ ref: `${names.nlt}.${chapter}`, version, key: env.NLT_API_KEY ?? 'TEST' });
    const response = await fetch(`${ENDPOINT}?${params.toString()}`, { headers: { Accept: 'text/html' } });
    if (!response.ok) throw new ProviderError(`NLT API responded ${response.status}`, response.status === 429 ? 429 : 502);
    const html = await response.text();
    const parsed = parseNltHtml(html);
    if (parsed.content.length === 0) throw new ProviderError('NLT API returned no verses', 404);
    return {
      provider: 'nlt',
      edition: version,
      book: book.toUpperCase(),
      chapter,
      content: parsed.content,
      footnotes: parsed.footnotes,
      copyright: COPYRIGHT,
    };
  },
};

interface ParseState {
  content: LiveItem[];
  footnotes: LiveFootnote[];
  verse: Extract<LiveItem, { type: 'verse' }> | undefined;
  /** Stack of open inline formats. */
  formats: string[];
  /** Current poetry level, when inside a poetry paragraph. */
  poem: number | undefined;
  /** Text of the footnote currently being collected, or undefined. */
  note: string | undefined;
  noteDepth: number;
  /** Depth of elements to skip entirely (verse numbers, chapter headers). */
  skipDepth: number;
  /** Depth of a heading/subtitle being collected. */
  blockText: { kind: 'heading' | 'subtitle'; text: string; depth: number } | undefined;
  depth: number;
  /** Whether the current verse already has visible text (controls line breaks). */
  verseHasText: boolean;
}

export function parseNltHtml(html: string): { content: LiveItem[]; footnotes: LiveFootnote[] } {
  const state: ParseState = {
    content: [],
    footnotes: [],
    verse: undefined,
    formats: [],
    poem: undefined,
    note: undefined,
    noteDepth: 0,
    skipDepth: 0,
    blockText: undefined,
    depth: 0,
    verseHasText: false,
  };
  const formatStack: Array<{ depth: number; format: string }> = [];

  for (const token of tokenize(html)) {
    if (token.kind === 'open' && !token.selfClosing) state.depth += 1;

    if (state.skipDepth > 0) {
      if (token.kind === 'close') {
        state.depth -= 1;
        if (state.depth < state.skipDepth) state.skipDepth = 0;
      }
      continue;
    }

    if (token.kind === 'text') {
      handleText(state, token.text);
      continue;
    }

    if (token.kind === 'open') {
      openTag(state, token, formatStack);
      if (token.selfClosing) continue;
      continue;
    }

    // close
    closeTag(state, token, formatStack);
    state.depth -= 1;
  }
  flushVerse(state);
  return { content: state.content, footnotes: state.footnotes };
}

function openTag(state: ParseState, token: Token, formatStack: Array<{ depth: number; format: string }>): void {
  const { name, attrs } = token;
  const cls = attrs['class'] ?? '';

  if (name === 'verse_export') {
    flushVerse(state);
    const number = Number(attrs['vn'] ?? '0');
    state.verse = { type: 'verse', number, parts: [] };
    state.verseHasText = false;
    return;
  }

  if ((name === 'h2' || name === 'h3') && hasClass(attrs, 'chapter-number')) {
    state.skipDepth = state.depth;
    return;
  }
  if (hasClass(attrs, 'bk_ch_vs_header') || hasClass(attrs, 'vn')) {
    state.skipDepth = state.depth;
    return;
  }

  if (/^h[1-6]$/.test(name) && hasClass(attrs, 'subhead')) {
    state.blockText = { kind: 'heading', text: '', depth: state.depth };
    return;
  }
  if (name === 'p' && (hasClass(attrs, 'psa-title') || hasClass(attrs, 'psa-book'))) {
    state.blockText = { kind: 'subtitle', text: '', depth: state.depth };
    return;
  }

  if (name === 'p') {
    const poetry = /^poet(\d)/.exec(cls);
    const level = poetry ? Number(poetry[1]) : undefined;
    // Paragraph boundaries are signalled by -sp (space), -hd (after heading), -fl (first line) classes.
    const startsParagraph = /-(sp|hd|fl)\b/.test(cls) || hasClass(attrs, 'body-sp');
    if (startsParagraph && state.verseHasText) {
      pushPart(state, { lineBreak: true });
    } else if (startsParagraph && !state.verseHasText && state.verse && state.verse.parts.length === 0) {
      // New paragraph starting with this verse: mark a break before it.
      state.content.push({ type: 'line_break' });
    } else if (level !== undefined && state.verseHasText) {
      pushPart(state, { lineBreak: true });
    }
    state.poem = level;
    return;
  }

  if (name === 'a' && hasClass(attrs, 'a-tn')) {
    state.skipDepth = state.depth;
    return;
  }
  if (name === 'span' && hasClass(attrs, 'tn')) {
    state.note = '';
    state.noteDepth = state.depth;
    return;
  }
  if (name === 'span' && hasClass(attrs, 'tn-ref')) {
    // The reference inside a footnote is kept as plain text.
    return;
  }
  if (name === 'span' && hasClass(attrs, 'red')) {
    formatStack.push({ depth: state.depth, format: 'woj' });
    state.formats = formatStack.map((f) => f.format);
    return;
  }
  if (name === 'br') {
    pushPart(state, { lineBreak: true });
  }
}

function closeTag(state: ParseState, token: Token, formatStack: Array<{ depth: number; format: string }>): void {
  if (state.blockText && state.depth === state.blockText.depth) {
    const text = state.blockText.text.replace(/\s+/g, ' ').trim();
    if (text) state.content.push(state.blockText.kind === 'heading' ? { type: 'heading', text } : { type: 'subtitle', text });
    state.blockText = undefined;
    return;
  }
  if (state.note !== undefined && state.depth === state.noteDepth) {
    const noteId = state.footnotes.length;
    state.footnotes.push({ noteId, text: state.note.replace(/\s+/g, ' ').trim() });
    pushPart(state, { noteId });
    state.note = undefined;
    return;
  }
  const top = formatStack[formatStack.length - 1];
  if (top && top.depth === state.depth) formatStack.pop();
  if (token.name === 'p') state.poem = undefined;
  if (token.name === 'verse_export') flushVerse(state);
  // Keep the format stack in sync with the parse state for text handling.
  state.formats = formatStack.map((f) => f.format);
}

function handleText(state: ParseState, raw: string): void {
  if (state.blockText) {
    state.blockText.text += raw;
    return;
  }
  if (state.note !== undefined) {
    state.note += raw;
    return;
  }
  if (!state.verse) return;
  const text = raw.replace(/\s+/g, ' ');
  if (text.trim().length === 0) return;
  const woj = state.formats.includes('woj');
  if (state.poem !== undefined || woj) {
    const part: Extract<LivePart, { text: string }> = { text };
    if (state.poem !== undefined) part.poem = state.poem;
    if (woj) part.wordsOfJesus = true;
    pushPart(state, part);
  } else {
    pushPart(state, text);
  }
  state.verseHasText = true;
}

function pushPart(state: ParseState, part: LivePart): void {
  if (!state.verse) return;
  const parts = state.verse.parts;
  const last = parts[parts.length - 1];
  // Merge adjacent plain strings and identically formatted text; avoid double line breaks.
  if (typeof part === 'string' && typeof last === 'string') {
    parts[parts.length - 1] = last + part;
    return;
  }
  if (isText(part) && isText(last) && last.poem === part.poem && Boolean(last.wordsOfJesus) === Boolean(part.wordsOfJesus)) {
    last.text += part.text;
    return;
  }
  if (typeof part === 'object' && 'lineBreak' in part && typeof last === 'object' && last !== null && 'lineBreak' in last) return;
  if (typeof part === 'object' && 'lineBreak' in part && parts.length === 0) return;
  parts.push(part);
}

function isText(part: LivePart | undefined): part is Extract<LivePart, { text: string }> {
  return typeof part === 'object' && part !== null && 'text' in part;
}

function flushVerse(state: ParseState): void {
  if (!state.verse) return;
  const parts = state.verse.parts;
  // Trim leading/trailing whitespace of string parts.
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (typeof part === 'string') parts[i] = i === 0 ? part.replace(/^\s+/, '') : part;
  }
  const last = parts[parts.length - 1];
  if (typeof last === 'string') parts[parts.length - 1] = last.replace(/\s+$/, '');
  if (parts.length > 0) state.content.push(state.verse);
  state.verse = undefined;
  state.verseHasText = false;
}

export type { ProviderEnv };
