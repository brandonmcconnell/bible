/**
 * ESV via Crossway's API (https://api.esv.org). Non-commercial use only; see
 * api.esv.org for the conditions (500 verses / half a book per page, copyright
 * notice and link to esv.org on every page, no storing beyond 500 verses).
 */
import { bookNames } from '../books.ts';
import { ProviderError, type LiveChapter, type LiveFootnote, type LiveItem, type LivePart, type Provider, type ProviderEnv } from '../types.ts';

const ENDPOINT = 'https://api.esv.org/v3/passage/text/';

const COPYRIGHT =
  'Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved.';

export const esvProvider: Provider = {
  id: 'esv',
  isConfigured: (env) => Boolean(env.ESV_API_KEY),
  async fetchChapter(env, _edition, book, chapter) {
    const key = env.ESV_API_KEY;
    if (!key) throw new ProviderError('ESV is not configured', 503);
    const names = bookNames(book);
    if (!names) throw new ProviderError(`Unknown book ${book}`, 404);

    const params = new URLSearchParams({
      q: `${names.name} ${chapter}`,
      'include-passage-references': 'false',
      'include-verse-numbers': 'true',
      'include-first-verse-numbers': 'true',
      'include-footnotes': 'true',
      'include-footnote-body': 'true',
      'include-headings': 'true',
      'include-short-copyright': 'false',
      'include-copyright': 'false',
      'include-passage-horizontal-lines': 'false',
      'include-heading-horizontal-lines': 'false',
      'include-selahs': 'true',
      'indent-poetry': 'false',
      'indent-paragraphs': '0',
      'indent-declares': '0',
      'indent-psalm-doxology': '0',
      'line-length': '0',
    });
    const response = await fetch(`${ENDPOINT}?${params.toString()}`, {
      headers: { Authorization: `Token ${key}`, Accept: 'application/json' },
    });
    if (!response.ok) throw new ProviderError(`ESV API responded ${response.status}`, response.status === 429 ? 429 : 502);
    const body: unknown = await response.json();
    const passage = extractPassage(body);
    if (passage === undefined) throw new ProviderError('ESV API returned no passage', 404);

    const parsed = parsePassage(passage);
    return {
      provider: 'esv',
      edition: 'esv',
      book: book.toUpperCase(),
      chapter,
      content: parsed.content,
      footnotes: parsed.footnotes,
      copyright: COPYRIGHT,
    };
  },
};

function extractPassage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const passages = (body as { passages?: unknown }).passages;
  if (!Array.isArray(passages)) return undefined;
  const first: unknown = passages[0];
  return typeof first === 'string' ? first : undefined;
}

/** Heading detection for chunks without verse markers: short, no sentence punctuation at the end. */
function looksLikeHeading(text: string): boolean {
  return text.length <= 90 && !/[.;:,!?]$/.test(text) && !/^\(\d+\)/.test(text);
}

export function parsePassage(passage: string): { content: LiveItem[]; footnotes: LiveFootnote[] } {
  let text = passage.replace(/\r\n/g, '\n').trim();
  const footnotes: LiveFootnote[] = [];

  const footnoteIndex = text.search(/\n\s*Footnotes\s*\n/);
  if (footnoteIndex !== -1) {
    const footnoteBlock = text.slice(footnoteIndex).replace(/^\s*Footnotes\s*/, '');
    text = text.slice(0, footnoteIndex).trim();
    for (const match of footnoteBlock.matchAll(/\((\d+)\)\s*([\s\S]*?)(?=\n\s*\(\d+\)|$)/g)) {
      footnotes.push({ noteId: Number(match[1]), text: (match[2] ?? '').replace(/\s+/g, ' ').trim() });
    }
  }

  const content: LiveItem[] = [];
  const chunks = text.split(/\n\s*\n/).map((c) => c.trim()).filter((c) => c.length > 0);
  let sawVerse = false;
  chunks.forEach((chunk, index) => {
    const hasMarker = /\[\d+\]/.test(chunk);
    if (!hasMarker) {
      if (looksLikeHeading(chunk)) {
        content.push({ type: 'heading', text: chunk.replace(/\s+/g, ' ') });
        return;
      }
      // A paragraph that continues the previous verse.
      if (sawVerse) {
        content.push({ type: 'line_break' });
        appendContinuation(content, chunk);
      }
      return;
    }
    if (index > 0 && sawVerse) content.push({ type: 'line_break' });
    const isPoetry = chunk.includes('\n');
    // Text before the first marker continues the previous verse.
    const firstMarker = chunk.search(/\[\d+\]/);
    if (firstMarker > 0) appendContinuation(content, chunk.slice(0, firstMarker));
    for (const match of chunk.slice(firstMarker).matchAll(/\[(\d+)\]\s*([\s\S]*?)(?=\[\d+\]|$)/g)) {
      const number = Number(match[1]);
      const verseText = (match[2] ?? '').trim();
      content.push({ type: 'verse', number, parts: toParts(verseText, isPoetry) });
      sawVerse = true;
    }
  });

  return { content, footnotes };
}

function appendContinuation(content: LiveItem[], text: string): void {
  const last = content[content.length - 1];
  const trimmed = text.trim();
  if (!trimmed) return;
  if (last && last.type === 'verse') {
    last.parts.push({ lineBreak: true }, ...toParts(trimmed, trimmed.includes('\n')));
  }
}

/** Splits verse text into parts: footnote markers `(n)` and, for poetry, one part per line. */
function toParts(text: string, poetry: boolean): LivePart[] {
  const parts: LivePart[] = [];
  const lines = poetry ? text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0) : [text.replace(/\s+/g, ' ')];
  lines.forEach((line, lineIndex) => {
    if (poetry && lineIndex > 0) parts.push({ lineBreak: true });
    let last = 0;
    for (const match of line.matchAll(/\((\d+)\)/g)) {
      const index = match.index ?? 0;
      const before = line.slice(last, index);
      if (before) parts.push(poetry ? { text: before, poem: poemLevel(lineIndex) } : before);
      parts.push({ noteId: Number(match[1]) });
      last = index + match[0].length;
    }
    const rest = line.slice(last);
    if (rest) parts.push(poetry ? { text: rest, poem: poemLevel(lineIndex) } : rest);
  });
  return parts;
}

function poemLevel(lineIndex: number): number {
  return lineIndex % 2 === 0 ? 1 : 2;
}
