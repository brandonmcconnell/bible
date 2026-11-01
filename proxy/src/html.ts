/**
 * Tiny HTML helpers for provider responses. Workers have no DOM, and the
 * markup the publishers return is small and regular, so a forgiving
 * tokenizer is enough.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  mdash: '\u2014',
  ndash: '\u2013',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  hellip: '\u2026',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

export interface Token {
  kind: 'open' | 'close' | 'text';
  name: string;
  attrs: Record<string, string>;
  text: string;
  selfClosing: boolean;
}

/** Splits HTML into open/close/text tokens. Comments and doctype are dropped. */
export function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;
  let last = 0;
  for (const match of html.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ kind: 'text', name: '', attrs: {}, text: decodeEntities(html.slice(last, index)), selfClosing: false });
    last = index + match[0].length;
    const closeName = match[1];
    const openName = match[2];
    if (closeName !== undefined) {
      tokens.push({ kind: 'close', name: closeName.toLowerCase(), attrs: {}, text: '', selfClosing: false });
    } else if (openName !== undefined) {
      tokens.push({
        kind: 'open',
        name: openName.toLowerCase(),
        attrs: parseAttrs(match[3] ?? ''),
        text: '',
        selfClosing: match[4] === '/',
      });
    }
  }
  if (last < html.length) tokens.push({ kind: 'text', name: '', attrs: {}, text: decodeEntities(html.slice(last)), selfClosing: false });
  return tokens;
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = match[1];
    if (!name) continue;
    attrs[name.toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

export function hasClass(attrs: Record<string, string>, className: string): boolean {
  return (attrs['class'] ?? '').split(/\s+/).includes(className);
}
