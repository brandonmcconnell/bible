/**
 * Helpers for emitting MDX safely. Scripture text is arbitrary Unicode that
 * may contain characters with meaning in Markdown or JSX, so every string that
 * ends up in a page goes through one of the escape functions below.
 */

const TEXT_ESCAPES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&/g, '&amp;'],
  [/</g, '&lt;'],
  [/>/g, '&gt;'],
  [/\{/g, '&#123;'],
  [/\}/g, '&#125;'],
  [/\*/g, '&#42;'],
  [/_/g, '&#95;'],
  [/`/g, '&#96;'],
  [/\[/g, '&#91;'],
  [/\]/g, '&#93;'],
  [/~/g, '&#126;'],
  [/\$/g, '&#36;'],
  [/\\/g, '&#92;'],
  [/\|/g, '&#124;'],
  [/#/g, '&#35;'],
];

/** Escapes text that will appear as a child text node inside JSX or inline Markdown. */
export function escapeText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of TEXT_ESCAPES) out = out.replace(pattern, replacement);
  return out;
}

/** Escapes a value for use inside a double-quoted JSX attribute. */
export function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
    .replace(/\r?\n/g, ' ');
}

/** Escapes text for a Markdown heading line (`## …`). */
export function escapeHeading(text: string): string {
  return escapeText(text).trim();
}

export type FrontmatterValue = string | number | boolean | readonly string[] | undefined;

/** Serializes frontmatter; string values are JSON-encoded, which is valid YAML. */
export function frontmatter(fields: Record<string, FrontmatterValue>): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => JSON.stringify(v)).join(', ')}]`);
    } else if (typeof value === 'string') {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

/** Produces a URL-safe slug from arbitrary text (ASCII letters, digits and dashes). */
export function slugify(text: string): string {
  const ascii = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii.length > 0 ? ascii : 'item';
}

/** Compresses a sorted list of verse numbers into ranges: 1, 2, 3, 5 → "1–3, 5". */
export function formatVerseList(verses: readonly number[]): string {
  const sorted = [...new Set(verses)].sort((a, b) => a - b);
  const parts: string[] = [];
  let index = 0;
  while (index < sorted.length) {
    const start = sorted[index];
    if (start === undefined) break;
    let end = start;
    while (index + 1 < sorted.length && sorted[index + 1] === end + 1) {
      index += 1;
      end += 1;
    }
    parts.push(start === end ? String(start) : `${start}–${end}`);
    index += 1;
  }
  return parts.join(', ');
}

export function formatYear(year: number): string {
  return year < 0 ? `${-year} BC` : `AD ${year}`;
}
