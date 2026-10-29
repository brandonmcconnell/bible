/**
 * Commentaries from the Free Use Bible API (`/api/c/...`): one page per
 * chapter with the commentary's introduction and its verse-by-verse notes, a
 * page per book (with the book introduction) and a landing page per
 * commentary. Scripture references link into the language's default
 * translation.
 */
import type { LanguageDefinition } from '../config.ts';
import { bookSlug, canonicalOrder, englishBookName, sectionOf, type Section } from './books.ts';
import { mapConcurrent, writeText } from './fs.ts';
import type { ChapterVerse, CommentaryBook, CommentaryChapter, CommentarySummary, HelloAoClient, VersePart } from './helloao.ts';
import type { UiStrings } from './i18n.ts';
import { escapeAttr, escapeHeading, escapeText, frontmatter, slugify } from './mdx.ts';
import { formatNumber, type PublishedTranslation } from './model.ts';
import type { NavGroup, NavMenuItem, NavTab } from './nav.ts';

export interface PublishedCommentaryBook {
  id: string;
  slug: string;
  name: string;
  section: Section;
  chapters: number[];
  introduction: string | undefined;
  /** Page path, e.g. `en/commentary/matthew-henry/genesis`. */
  path: string;
}

export interface PublishedCommentary {
  summary: CommentarySummary;
  slug: string;
  name: string;
  /** Page path, e.g. `en/commentary/matthew-henry`. */
  path: string;
  books: PublishedCommentaryBook[];
  bookById: Map<string, PublishedCommentaryBook>;
}

export interface CommentaryLink {
  name: string;
  path: string;
}

export interface CommentaryBuildOptions {
  client: HelloAoClient;
  language: LanguageDefinition;
  selection: 'all' | string[];
  /** Page path prefix, e.g. `en/commentary`. */
  basePath: string;
  linkTranslation: PublishedTranslation;
  ui: UiStrings;
  concurrency: number;
  /** Restrict to these chapters (sample builds). */
  filter: ((bookId: string, chapter: number) => boolean) | undefined;
  onProgress: (message: string) => void;
}

export interface CommentaryBuildResult {
  commentaries: PublishedCommentary[];
  tab: NavTab | undefined;
  pages: number;
  /** Commentary chapter pages keyed by `BOOK:chapter`, for links from scripture pages. */
  chapterLinks: Map<string, CommentaryLink[]>;
}

const SECTION_ICONS = { ot: 'scroll-text', nt: 'cross', extra: 'book-copy' } as const;

export async function buildCommentaries(options: CommentaryBuildOptions): Promise<CommentaryBuildResult> {
  const { client, language, basePath, ui, concurrency, onProgress } = options;
  const isoCodes = new Set(language.iso);
  const available = (await client.availableCommentaries()).filter((c) => isoCodes.has(c.language));
  const selected = options.selection === 'all' ? available : available.filter((c) => options.selection.includes(c.id));
  if (selected.length === 0) return { commentaries: [], tab: undefined, pages: 0, chapterLinks: new Map() };

  const commentaries: PublishedCommentary[] = [];
  const chapterLinks = new Map<string, CommentaryLink[]>();
  let pages = 0;

  for (const summary of selected) {
    const slug = slugify(summary.id);
    const path = `${basePath}/${slug}`;
    const apiBooks = await client.commentaryBooks(summary.id);
    const books: PublishedCommentaryBook[] = apiBooks
      .map((book) => toPublishedBook(book, path, options.filter))
      .filter((book) => book.chapters.length > 0)
      .sort((a, b) => canonicalOrder(a.id) - canonicalOrder(b.id));
    const commentary: PublishedCommentary = {
      summary,
      slug,
      name: summary.name,
      path,
      books,
      bookById: new Map(books.map((b) => [b.id, b])),
    };
    commentaries.push(commentary);

    const targets = books.flatMap((book) => book.chapters.map((chapter) => ({ book, chapter })));
    onProgress(`${summary.name}: ${targets.length} chapters`);
    const missing = new Set<string>();
    await mapConcurrent(targets, concurrency, async ({ book, chapter }) => {
      let data: CommentaryChapter;
      try {
        data = await client.commentaryChapter(summary.id, book.id, chapter);
      } catch (error: unknown) {
        // Commentaries skip chapters they have nothing to say about; the API returns 404 for those.
        if (error instanceof Error && /HTTP 404/.test(error.message)) {
          missing.add(`${book.id}:${chapter}`);
          return;
        }
        throw error;
      }
      await writeText(`${book.path}/${chapter}.mdx`, renderCommentaryChapter(commentary, book, data, options.linkTranslation, ui));
      pages += 1;
      const key = `${book.id}:${chapter}`;
      const links = chapterLinks.get(key) ?? [];
      links.push({ name: summary.name, path: `/${book.path}/${chapter}` });
      chapterLinks.set(key, links);
    });
    if (missing.size > 0) {
      for (const book of books) book.chapters = book.chapters.filter((chapter) => !missing.has(`${book.id}:${chapter}`));
      onProgress(`${summary.name}: ${missing.size} chapters without commentary skipped`);
    }
    for (const book of books) {
      await writeText(`${book.path}/index.mdx`, renderCommentaryBook(commentary, book, ui));
      pages += 1;
    }
    await writeText(`${path}/index.mdx`, renderCommentaryHome(commentary, ui, options.linkTranslation));
    pages += 1;
  }

  await writeText(`${basePath}/index.mdx`, renderCommentariesIndex(commentaries, ui));
  pages += 1;

  const menu: NavMenuItem[] = [
    { item: ui.commentaries, icon: 'book-marked', pages: [`${basePath}/index`] },
    ...commentaries.map((commentary) => ({
      item: commentary.name,
      icon: 'book-marked',
      groups: commentaryGroups(commentary, ui),
    })),
  ];

  return {
    commentaries,
    tab: { tab: ui.commentaries, icon: 'book-marked', menu },
    pages,
    chapterLinks,
  };
}

function toPublishedBook(book: CommentaryBook, commentaryPath: string, filter: CommentaryBuildOptions['filter']): PublishedCommentaryBook {
  const chapters: number[] = [];
  if (book.firstChapterNumber !== null && book.lastChapterNumber !== null) {
    for (let chapter = book.firstChapterNumber; chapter <= book.lastChapterNumber; chapter += 1) {
      if (!filter || filter(book.id, chapter)) chapters.push(chapter);
    }
  }
  const slug = bookSlug(book.id);
  return {
    id: book.id,
    slug,
    name: book.commonName.trim().length > 0 ? book.commonName.trim() : englishBookName(book.id),
    section: sectionOf(book.id),
    chapters,
    introduction: book.introduction,
    path: `${commentaryPath}/${slug}`,
  };
}

function commentaryGroups(commentary: PublishedCommentary, ui: UiStrings): NavGroup[] {
  const groups: NavGroup[] = [{ group: commentary.name, icon: 'book-marked', pages: [`${commentary.path}/index`] }];
  const sections: Array<{ key: Section; label: string }> = [
    { key: 'ot', label: ui.oldTestament },
    { key: 'nt', label: ui.newTestament },
    { key: 'extra', label: ui.apocrypha },
  ];
  for (const section of sections) {
    const books = commentary.books.filter((b) => b.section === section.key);
    if (books.length === 0) continue;
    groups.push({
      group: section.label,
      icon: SECTION_ICONS[section.key],
      pages: books.map((book) => ({
        group: book.name,
        pages: [`${book.path}/index`, ...book.chapters.map((chapter) => `${book.path}/${chapter}`)],
      })),
    });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

/** Splits commentary prose on newlines into escaped paragraphs. */
function paragraphs(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\n+/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${escapeText(p)}</p>`);
}

function partsToText(parts: VersePart[]): string {
  let out = '';
  for (const part of parts) {
    if (typeof part === 'string') out += part;
    else if (part.kind === 'text') out += part.text;
    else if (part.kind === 'lineBreak') out += '\n';
    else if (part.kind === 'heading') out += `\n${part.heading}\n`;
  }
  return out;
}

function scriptureLink(translation: PublishedTranslation, bookId: string, chapter: number, verse: number | undefined): string | undefined {
  const book = translation.bookById.get(bookId);
  if (!book || !book.chapters.some((c) => c.number === chapter)) return undefined;
  return `/${book.path}/${chapter}${verse !== undefined ? `#v${verse}` : ''}`;
}

function renderCommentaryChapter(
  commentary: PublishedCommentary,
  book: PublishedCommentaryBook,
  chapter: CommentaryChapter,
  translation: PublishedTranslation,
  ui: UiStrings,
): string {
  const scriptureBookName = translation.bookById.get(book.id)?.name ?? book.name;
  const chapterLink = scriptureLink(translation, book.id, chapter.number, undefined);
  const lines: string[] = [
    frontmatter({
      title: `${book.name} ${chapter.number}`,
      sidebarTitle: String(chapter.number),
      description: commentary.name,
    }),
    `<div className="cm-chapter" lang="${translation.language.htmlLang}" data-commentary="${escapeAttr(commentary.slug)}" data-book="${book.id}" data-chapter="${chapter.number}">`,
    '',
  ];
  if (chapterLink) {
    lines.push(`<div className="cm-actions">`, `<span className="ent">[${escapeText(`${ui.readChapter}: ${scriptureBookName} ${chapter.number} (${translation.label})`)}](${chapterLink})</span>`, '</div>', '');
  }
  const intro = paragraphs(chapter.introduction);
  if (intro.length > 0) {
    lines.push(`## ${escapeHeading(ui.introduction)}`, '', '<div className="cm-intro">', ...intro, '</div>', '');
  }
  for (const verse of chapter.content) {
    lines.push(...renderVerseComment(verse, book, chapter.number, translation, scriptureBookName));
  }
  lines.push('</div>', '');
  return lines.join('\n');
}

function renderVerseComment(
  verse: ChapterVerse,
  book: PublishedCommentaryBook,
  chapter: number,
  translation: PublishedTranslation,
  scriptureBookName: string,
): string[] {
  const label = `${scriptureBookName} ${chapter}:${verse.number}`;
  const link = scriptureLink(translation, book.id, chapter, verse.number);
  const head = link ? `[${escapeText(label)}](${link})` : escapeText(label);
  return [
    `<div className="cmv" id="v${verse.number}" data-v="${verse.number}">`,
    `<div className="cmv-head">${head}</div>`,
    ...paragraphs(partsToText(verse.content)),
    '</div>',
    '',
  ];
}

function renderCommentaryBook(commentary: PublishedCommentary, book: PublishedCommentaryBook, ui: UiStrings): string {
  const lines: string[] = [
    frontmatter({ title: book.name, sidebarTitle: ui.overview, description: commentary.name }),
    '<div className="bible-book cm-book">',
    '',
    '<div className="cgrid">',
    ...book.chapters.map((chapter) => `[${chapter}](/${book.path}/${chapter})`),
    '</div>',
    '',
  ];
  const intro = paragraphs(book.introduction);
  if (intro.length > 0) lines.push(`## ${escapeHeading(ui.introduction)}`, '', '<div className="cm-intro">', ...intro, '</div>', '');
  lines.push('</div>', '');
  return lines.join('\n');
}

function renderCommentaryHome(commentary: PublishedCommentary, ui: UiStrings, translation: PublishedTranslation): string {
  const { summary } = commentary;
  const locale = translation.language.htmlLang;
  const chapterCount = commentary.books.reduce((n, b) => n + b.chapters.length, 0);
  const lines: string[] = [
    frontmatter({ title: commentary.name, sidebarTitle: ui.overview, description: summary.englishName !== summary.name ? summary.englishName : ui.commentary, icon: 'book-marked' }),
    '<div className="bible-home">',
    '',
    '<div className="bmeta">',
    `<span>${escapeText(`${formatNumber(commentary.books.length, locale)} ${ui.books.toLowerCase()}`)}</span>`,
    `<span>${escapeText(`${formatNumber(chapterCount, locale)} ${ui.chapters.toLowerCase()}`)}</span>`,
    '</div>',
    '',
  ];
  const sections: Array<{ key: Section; label: string }> = [
    { key: 'ot', label: ui.oldTestament },
    { key: 'nt', label: ui.newTestament },
    { key: 'extra', label: ui.apocrypha },
  ];
  for (const section of sections) {
    const books = commentary.books.filter((b) => b.section === section.key);
    if (books.length === 0) continue;
    lines.push(`## ${escapeHeading(section.label)}`, '', '<div className="bgrid">');
    for (const book of books) {
      lines.push(`<span className="bg-item">[${escapeText(book.name)}](/${book.path})<span className="bg-count">${book.chapters.length}</span></span>`);
    }
    lines.push('</div>', '');
  }
  lines.push(`## ${escapeHeading(ui.source)}`, '');
  lines.push(`- **${escapeText(ui.commentary)}:** ${escapeText(summary.name)}`);
  lines.push(`- **ID:** \`${summary.id}\``);
  if (summary.website) lines.push(`- **${escapeText(ui.website)}:** [${escapeText(summary.website.replace(/^https?:\/\//, ''))}](${summary.website})`);
  if (summary.licenseUrl) lines.push(`- **${escapeText(ui.license)}:** [${escapeText(summary.licenseUrl.replace(/^https?:\/\//, ''))}](${summary.licenseUrl})`);
  if (summary.licenseNotes) lines.push('', escapeText(summary.licenseNotes));
  lines.push('', escapeText(ui.dataProvidedBy), '', '</div>', '');
  return lines.join('\n');
}

function renderCommentariesIndex(commentaries: readonly PublishedCommentary[], ui: UiStrings): string {
  const lines: string[] = [
    frontmatter({ title: ui.commentaries, sidebarTitle: ui.overview, icon: 'book-marked' }),
    '<Columns cols={2}>',
  ];
  for (const commentary of commentaries) {
    const chapterCount = commentary.books.reduce((n, b) => n + b.chapters.length, 0);
    lines.push(
      `  <Card title="${escapeAttr(commentary.name)}" icon="book-marked" href="/${commentary.path}">${commentary.books.length} ${escapeText(ui.books.toLowerCase())} · ${chapterCount} ${escapeText(ui.chapters.toLowerCase())}</Card>`,
    );
  }
  lines.push('</Columns>', '');
  return lines.join('\n');
}
