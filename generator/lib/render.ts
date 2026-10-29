/**
 * Renders scripture pages (chapter, book and translation landing pages) to MDX.
 *
 * Every verse becomes its own `<span class="v">` carrying `data-v`, so the
 * stylesheet can draw verse numbers with `::before` and cross references with
 * `::after`, and the reader script can select/copy verses and load cross
 * references without touching the text.
 */
import { englishBookName } from './books.ts';
import type { ChapterData, CrossRefChapter, EntityChapter, Footnote, ScoredVerseRef, VersePart } from './helloao.ts';
import { escapeAttr, escapeHeading, escapeText, formatVerseList, frontmatter } from './mdx.ts';
import { chapterPath, formatNumber, type PublishedBook, type PublishedTranslation } from './model.ts';

export interface ChapterRenderOptions {
  /** Theographic mentions for this chapter (English study section only). */
  entities: EntityChapter | undefined;
  /** URL prefix for study pages, e.g. `/en/study`. */
  studyBasePath: string | undefined;
  /** Cross references for this chapter; the top few per verse are embedded as `data-xref`. */
  crossRefs: CrossRefChapter | undefined;
  /** Commentary chapter pages covering this chapter. */
  commentaries: readonly CommentaryLink[] | undefined;
}

export interface CommentaryLink {
  name: string;
  path: string;
}

/** How many cross references to embed per verse for the CSS `::after` display. */
export const EMBEDDED_XREFS_PER_VERSE = 3;

/** Paragraph marks (pilcrows) that some texts, notably the KJV, carry inline. */
const PILCROW = /\u00b6\s*/g;

// ---------------------------------------------------------------------------
// Chapter pages
// ---------------------------------------------------------------------------

/** Turns a zero-based footnote index into a caller label: a … z, aa, ab, … */
export function callerLabel(index: number): string {
  let n = index;
  let label = '';
  do {
    label = String.fromCharCode(97 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

interface FootnoteEntry {
  footnote: Footnote;
  label: string;
}

class ChapterWriter {
  private readonly lines: string[] = [];
  private inText = false;
  private inParagraph = false;
  private paragraphIsPoetry = false;
  private paragraphStart = -1;

  constructor(
    private readonly notes: Map<number, FootnoteEntry>,
    private readonly rtl: boolean,
    private readonly xrefFor: (verse: number) => string | undefined,
  ) {}

  heading(text: string): void {
    this.closeParagraph();
    this.closeText();
    this.lines.push('', `## ${escapeHeading(text)}`, '');
  }

  hebrewSubtitle(parts: VersePart[]): void {
    this.closeParagraph();
    this.openText();
    this.lines.push(`<div className="hs">${this.renderParts(parts, false)}</div>`);
  }

  paragraphBreak(): void {
    this.closeParagraph();
  }

  verse(number: number, parts: VersePart[]): void {
    const cleaned = this.stripPilcrows(parts);
    if (cleaned.startsParagraph) this.closeParagraph();
    this.openText();
    this.openParagraph();
    const segments = this.splitAtInlineHeadings(cleaned.parts);
    const xref = this.xrefFor(number);
    const xrefAttr = xref ? ` data-xref="${escapeAttr(xref)}"` : '';
    segments.forEach((segment, index) => {
      if (segment.heading !== undefined) {
        this.heading(segment.heading);
        this.openText();
        this.openParagraph();
      }
      if (segment.parts.length === 0 && segments.length > 1) return;
      const continuation = index > 0;
      const idAttr = continuation ? '' : ` id="v${number}"`;
      const className = continuation ? 'v vc' : 'v';
      const hasPoetry = segment.parts.some((p) => typeof p !== 'string' && p.kind === 'text' && p.poem !== undefined);
      if (hasPoetry) this.paragraphIsPoetry = true;
      // The leading space inside the span is deliberate: whitespace *between*
      // inline JSX siblings is discarded by the MDX pipeline, so the separator
      // has to live inside the verse. Browsers collapse it at line starts.
      this.lines.push(
        `<span className="${className}"${idAttr} data-v="${number}"${continuation ? '' : xrefAttr}> ${this.renderParts(segment.parts, true)}</span>`,
      );
    });
  }

  /** Removes pilcrows; a pilcrow at the very start of a verse begins a new paragraph. */
  private stripPilcrows(parts: VersePart[]): { parts: VersePart[]; startsParagraph: boolean } {
    let startsParagraph = false;
    let seenText = false;
    const out: VersePart[] = [];
    for (const part of parts) {
      if (typeof part === 'string') {
        let text = part;
        if (!seenText && /^\s*\u00b6/.test(text)) startsParagraph = true;
        text = text.replace(PILCROW, '');
        if (text.trim().length > 0) seenText = true;
        if (text.length > 0) out.push(text);
      } else if (part.kind === 'text') {
        let text = part.text;
        if (!seenText && /^\s*\u00b6/.test(text)) startsParagraph = true;
        text = text.replace(PILCROW, '');
        if (text.trim().length > 0) seenText = true;
        if (text.length > 0) out.push({ ...part, text });
      } else {
        out.push(part);
      }
    }
    return { parts: out, startsParagraph };
  }

  finish(): string {
    this.closeParagraph();
    this.closeText();
    return this.lines.join('\n');
  }

  private splitAtInlineHeadings(parts: VersePart[]): Array<{ heading: string | undefined; parts: VersePart[] }> {
    const segments: Array<{ heading: string | undefined; parts: VersePart[] }> = [{ heading: undefined, parts: [] }];
    for (const part of parts) {
      if (typeof part !== 'string' && part.kind === 'heading') {
        segments.push({ heading: part.heading, parts: [] });
      } else {
        const current = segments[segments.length - 1];
        if (current) current.parts.push(part);
      }
    }
    return segments;
  }

  private renderParts(parts: VersePart[], allowPoetryBreaks: boolean): string {
    let out = '';
    let renderedSomething = false;
    let atLineStart = true;
    for (const part of parts) {
      if (typeof part === 'string') {
        out += escapeText(part);
        if (part.trim().length > 0) {
          renderedSomething = true;
          atLineStart = false;
        }
        continue;
      }
      switch (part.kind) {
        case 'note': {
          const entry = this.notes.get(part.noteId);
          if (entry) {
            out += `<sup className="fn"><a href="#fn-${entry.label}" id="fnref-${entry.label}" data-fn="${escapeAttr(entry.footnote.text)}">${entry.label}</a></sup>`;
          }
          break;
        }
        case 'lineBreak':
          out += '<br />';
          atLineStart = true;
          break;
        case 'heading':
          // Handled by splitAtInlineHeadings for verses; ignore elsewhere.
          break;
        case 'text': {
          const classes: string[] = [];
          if (part.poem !== undefined) classes.push('pl', `pl-${Math.min(Math.max(part.poem, 1), 4)}`);
          if (part.wordsOfJesus) classes.push('woj');
          if (part.descriptive) classes.push('desc');
          const text = escapeText(part.text);
          if (part.poem !== undefined && allowPoetryBreaks && renderedSomething && !atLineStart) out += '<br />';
          out += classes.length > 0 ? `<span className="${classes.join(' ')}">${text}</span>` : text;
          if (part.text.trim().length > 0) {
            renderedSomething = true;
            atLineStart = false;
          }
          break;
        }
        default:
          break;
      }
    }
    return out;
  }

  private openText(): void {
    if (this.inText) return;
    this.lines.push(`<div className="bt"${this.rtl ? ' dir="rtl"' : ''}>`);
    this.inText = true;
  }

  private closeText(): void {
    if (!this.inText) return;
    this.lines.push('</div>');
    this.inText = false;
  }

  private openParagraph(): void {
    if (this.inParagraph) return;
    this.paragraphStart = this.lines.length;
    this.lines.push('<div className="bp">');
    this.inParagraph = true;
    this.paragraphIsPoetry = false;
  }

  private closeParagraph(): void {
    if (!this.inParagraph) return;
    if (this.paragraphIsPoetry && this.paragraphStart >= 0) {
      this.lines[this.paragraphStart] = '<div className="bp poetry">';
    }
    this.lines.push('</div>');
    this.inParagraph = false;
    this.paragraphStart = -1;
  }
}

function indexFootnotes(chapter: ChapterData): Map<number, FootnoteEntry> {
  const notes = new Map<number, FootnoteEntry>();
  let autoIndex = 0;
  for (const footnote of chapter.footnotes) {
    let label: string;
    if (footnote.caller === '+' || footnote.caller === null || footnote.caller.trim().length === 0) {
      label = callerLabel(autoIndex);
      autoIndex += 1;
    } else {
      label = footnote.caller.trim().replace(/[^\p{L}\p{N}]/gu, '') || callerLabel(autoIndex++);
    }
    notes.set(footnote.noteId, { footnote, label });
  }
  return notes;
}

function renderFootnotes(notes: Map<number, FootnoteEntry>, ui: PublishedTranslation['ui']): string {
  if (notes.size === 0) return '';
  const items = [...notes.values()].map(({ footnote, label }) => {
    const ref = footnote.reference ? `<span className="fnr">${footnote.reference.chapter}:${footnote.reference.verse}</span> ` : '';
    return `<li id="fn-${label}"><a href="#fnref-${label}" className="fnb">${label}</a> ${ref}${escapeText(footnote.text)}</li>`;
  });
  return ['<div className="bible-footnotes">', '', `## ${escapeHeading(ui.footnotes)}`, '', '<ol className="fnl">', ...items, '</ol>', '', '</div>'].join(
    '\n',
  );
}

function renderRelated(
  entities: EntityChapter | undefined,
  commentaries: readonly CommentaryLink[] | undefined,
  studyBasePath: string | undefined,
  ui: PublishedTranslation['ui'],
): string {
  const rows: string[] = [];
  const row = (label: string, items: string[]): void => {
    if (items.length === 0) return;
    // The opening tag must be alone on its line for MDX to treat the div as a flow element.
    rows.push('<div className="entrow">', `<span className="entk">${escapeText(label)}</span>`, ...items, '</div>', '');
  };
  const mentions = (type: 'people' | 'places' | 'events', items: Array<{ id: string; name: string; verses: number[] }>): string[] =>
    studyBasePath
      ? items.map(
          (item) =>
            `<span className="ent">[${escapeText(item.name)}](${studyBasePath}/${type}/${entitySlug(item.id)})<span className="entv">${formatVerseList(item.verses)}</span></span>`,
        )
      : [];
  if (entities) {
    row(ui.people, mentions('people', entities.people));
    row(ui.places, mentions('places', entities.places));
    row(ui.events, mentions('events', entities.events));
  }
  if (commentaries && commentaries.length > 0) {
    row(
      ui.commentaries,
      commentaries.map((c) => `<span className="ent">[${escapeText(c.name)}](${c.path})</span>`),
    );
  }
  if (rows.length === 0) return '';
  return ['<div className="bible-entities">', '', `## ${escapeHeading(ui.inThisChapter)}`, '', ...rows, '', '</div>'].join('\n');
}

/** Formats a reference using the translation's own book names, falling back to English. */
export function formatReference(translation: PublishedTranslation, ref: ScoredVerseRef): string {
  const name = translation.bookById.get(ref.book)?.name ?? englishBookName(ref.book);
  const verses = ref.endVerse !== undefined && ref.endVerse !== ref.verse ? `${ref.verse}–${ref.endVerse}` : String(ref.verse);
  return `${name} ${ref.chapter}:${verses}`;
}

/** Theographic ids look like `paul_2479`; URLs use dashes. */
export function entitySlug(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function renderChapterPage(
  translation: PublishedTranslation,
  book: PublishedBook,
  chapter: ChapterData,
  options: ChapterRenderOptions,
): string {
  const { ui } = translation;
  const notes = indexFootnotes(chapter);
  const xrefByVerse = new Map<number, ScoredVerseRef[]>();
  for (const verse of options.crossRefs?.content ?? []) xrefByVerse.set(verse.verse, verse.references);
  const xrefFor = (verse: number): string | undefined => {
    const refs = xrefByVerse.get(verse);
    if (!refs || refs.length === 0) return undefined;
    return refs
      .slice(0, EMBEDDED_XREFS_PER_VERSE)
      .map((ref) => formatReference(translation, ref))
      .join('; ');
  };
  const writer = new ChapterWriter(notes, translation.dir === 'rtl', xrefFor);

  for (const item of chapter.content) {
    switch (item.type) {
      case 'heading':
        writer.heading(item.content.join(' '));
        break;
      case 'line_break':
        writer.paragraphBreak();
        break;
      case 'hebrew_subtitle':
        writer.hebrewSubtitle(item.content);
        break;
      case 'verse':
        writer.verse(item.number, item.content);
        break;
      default:
        break;
    }
  }

  const title = `${book.name} ${chapter.number}`;
  const description = book.title ? `${book.title} · ${translation.name}` : translation.name;
  const verseCount = chapter.content.filter((item) => item.type === 'verse').length;

  const containerAttrs = [
    `className="bible-chapter"`,
    `lang="${translation.language.htmlLang}"`,
    `dir="${translation.dir}"`,
    `data-lang="${translation.language.code}"`,
    `data-translation="${translation.slug}"`,
    `data-translation-id="${escapeAttr(translation.summary.id)}"`,
    `data-translation-label="${escapeAttr(translation.label)}"`,
    `data-book="${book.id}"`,
    `data-book-slug="${book.slug}"`,
    `data-book-name="${escapeAttr(book.name)}"`,
    `data-chapter="${chapter.number}"`,
    `data-verses="${verseCount}"`,
  ].join(' ');

  const parts: string[] = [
    frontmatter({ title, sidebarTitle: String(chapter.number), description }),
    `<div ${containerAttrs}>`,
    '',
    writer.finish(),
    '',
    '</div>',
  ];

  const footnotes = renderFootnotes(notes, ui);
  if (footnotes) parts.push('', footnotes);

  const related = renderRelated(options.entities, options.commentaries, options.studyBasePath, ui);
  if (related) parts.push('', related);

  parts.push('');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Book landing pages
// ---------------------------------------------------------------------------

export function renderBookPage(translation: PublishedTranslation, book: PublishedBook): string {
  const { ui } = translation;
  const locale = translation.language.htmlLang;
  const chapterLinks = book.chapters.map((chapter) => `[${chapter.number}](/${chapterPath(book, chapter.number)})`);
  const verseTotal = book.chapters.reduce((sum, chapter) => sum + chapter.content.filter((c) => c.type === 'verse').length, 0);

  const lines: string[] = [
    frontmatter({
      title: book.name,
      sidebarTitle: ui.overview,
      description: book.title ?? `${book.name} · ${translation.name}`,
    }),
    `<div className="bible-book" lang="${translation.language.htmlLang}" dir="${translation.dir}" data-book="${book.id}" data-translation="${translation.slug}">`,
    '',
    ...metaBlock([
      `${formatNumber(book.chapters.length, locale)} ${ui.chapters.toLowerCase()}`,
      `${formatNumber(verseTotal, locale)} ${ui.verses.toLowerCase()}`,
      translation.name,
    ]),
    '<div className="cgrid">',
    ...chapterLinks,
    '</div>',
    '',
    '</div>',
    '',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Translation landing pages
// ---------------------------------------------------------------------------

export function renderTranslationPage(
  translation: PublishedTranslation,
  siblings: PublishedTranslation[],
  studyBasePath: string | undefined,
  repositoryUrl: string,
): string {
  const { ui, summary } = translation;
  const locale = translation.language.htmlLang;
  const chapterCount = translation.books.reduce((sum, book) => sum + book.chapters.length, 0);
  const verseCount = translation.books.reduce(
    (sum, book) => sum + book.chapters.reduce((s, c) => s + c.content.filter((item) => item.type === 'verse').length, 0),
    0,
  );

  const lines: string[] = [
    frontmatter({
      title: translation.name,
      sidebarTitle: ui.overview,
      description: summary.englishName !== translation.name ? summary.englishName : `${ui.bible} · ${translation.label}`,
      icon: 'book-open',
    }),
    `<div className="bible-home" lang="${translation.language.htmlLang}" dir="${translation.dir}">`,
    '',
    escapeText(ui.translationIntro),
    '',
    ...metaBlock([
      `${formatNumber(translation.books.length, locale)} ${ui.books.toLowerCase()}`,
      `${formatNumber(chapterCount, locale)} ${ui.chapters.toLowerCase()}`,
      `${formatNumber(verseCount, locale)} ${ui.verses.toLowerCase()}`,
    ]),
  ];

  for (const section of translation.sections) {
    lines.push(`## ${escapeHeading(section.label)}`, '', '<div className="bgrid">');
    for (const book of section.books) {
      lines.push(
        `<span className="bg-item">[${escapeText(book.name)}](/${book.path})<span className="bg-count">${formatNumber(book.chapters.length, locale)}</span></span>`,
      );
    }
    lines.push('</div>', '');
  }

  lines.push(`## ${escapeHeading(ui.readingTools)}`, '', escapeText(ui.readingToolsHelp), '', escapeText(ui.keyboardHint), '');

  if (siblings.length > 0) {
    lines.push(`## ${escapeHeading(ui.otherTranslations)}`, '');
    for (const sibling of siblings) {
      lines.push(`- [${escapeText(sibling.name)}](/${sibling.path}) (${escapeText(sibling.label)})`);
    }
    lines.push('');
  }

  if (studyBasePath) {
    lines.push(`## ${escapeHeading(ui.study)}`, '', `[${escapeText(ui.study)}](${studyBasePath}) — ${escapeText(ui.studyIntro)}`, '');
  }

  lines.push(`## ${escapeHeading(ui.aboutTranslation)}`, '');
  lines.push(`- **${escapeText(ui.translation)}:** ${escapeText(summary.name)}${summary.englishName !== summary.name ? ` (${escapeText(summary.englishName)})` : ''}`);
  lines.push(`- **ID:** \`${summary.id}\``);
  if (summary.website) lines.push(`- **${escapeText(ui.website)}:** [${escapeText(displayUrl(summary.website))}](${summary.website})`);
  if (summary.licenseUrl) lines.push(`- **${escapeText(ui.license)}:** [${escapeText(displayUrl(summary.licenseUrl))}](${summary.licenseUrl})`);
  lines.push(`- **${escapeText(ui.source)}:** [Free Use Bible API](https://bible.helloao.org/) · [${escapeText('GitHub')}](${repositoryUrl})`);
  lines.push('', escapeText(ui.dataProvidedBy), '', '</div>', '');

  return lines.join('\n');
}

/** A row of small statistics. Emitted as a flow block (opening tag alone on its line). */
function metaBlock(items: readonly string[]): string[] {
  return ['<div className="bmeta">', ...items.map((item) => `<span>${escapeText(item)}</span>`), '</div>', ''];
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
