/**
 * Builds the publishable model of a translation: which books it has, how they
 * are grouped into sections, and where each page lives.
 */
import type { Canon, LanguageDefinition, TranslationOverrides } from '../config.ts';
import { bookSlug, canonicalOrder, CATHOLIC_OLD_TESTAMENT_ORDER, englishBookName, sectionOf, type Section } from './books.ts';
import type { ChapterData, CompleteTranslation, TranslationBook, TranslationSummary } from './helloao.ts';
import { RTL_LANGUAGES, uiStrings, type UiStrings } from './i18n.ts';
import { slugify } from './mdx.ts';

/** Fully resolved per-translation settings (overrides merged with derived defaults). */
export interface ResolvedTranslation {
  id: string;
  slug: string;
  label: string;
  name: string;
  canon: Canon;
  extraBooksLabel: 'apocrypha' | 'deuterocanon';
  default: boolean;
  tag: string | undefined;
}

export interface PublishedBook {
  id: string;
  slug: string;
  /** Display name in the translation's own language. */
  name: string;
  englishName: string;
  title: string | null;
  section: Section;
  chapters: ChapterData[];
  totalVerses: number;
  /** Page path without extension, e.g. `en/kjv/genesis`. */
  path: string;
}

export interface PublishedSection {
  key: Section;
  label: string;
  books: PublishedBook[];
}

export interface PublishedTranslation {
  language: LanguageDefinition;
  config: ResolvedTranslation;
  summary: TranslationSummary;
  ui: UiStrings;
  name: string;
  label: string;
  slug: string;
  /** Page path of the translation landing page, e.g. `en/kjv`. */
  path: string;
  dir: 'ltr' | 'rtl';
  books: PublishedBook[];
  sections: PublishedSection[];
  bookById: Map<string, PublishedBook>;
}

const CATHOLIC_NAME_PATTERN = /catholic|douay|vulgat|crampon|canisius|jerusalem|deuterocanon/i;

/**
 * Merges curated overrides with values derived from the API summary. Slug
 * uniqueness within a language is enforced by the caller.
 */
export function resolveTranslation(summary: TranslationSummary, overrides: TranslationOverrides | undefined, bookIds: readonly string[]): ResolvedTranslation {
  const hasOt = bookIds.some((id) => sectionOf(id) === 'ot');
  const hasNt = bookIds.some((id) => sectionOf(id) === 'nt');
  const hasExtra = bookIds.some((id) => sectionOf(id) === 'extra');
  const looksCatholic = CATHOLIC_NAME_PATTERN.test(`${summary.name} ${summary.englishName}`);
  const canon: Canon = overrides?.canon ?? (hasExtra && looksCatholic ? 'catholic' : 'protestant');

  let tag = overrides?.tag;
  if (tag === undefined) {
    if (hasExtra) tag = canon === 'catholic' ? 'Catholic' : 'Apocrypha';
    else if (hasNt && !hasOt) tag = 'NT';
    else if (hasOt && !hasNt) tag = 'OT';
    else if (bookIds.length < 66) tag = 'Partial';
  }

  const shortName = summary.shortName.trim();
  const derivedSlug = slugify(shortName.length > 0 ? shortName : summary.id);
  return {
    id: summary.id,
    slug: overrides?.slug ?? (derivedSlug === 'item' ? slugify(summary.id) : derivedSlug),
    label: overrides?.label ?? (shortName.length > 0 ? shortName : summary.id),
    name: overrides?.name ?? summary.name,
    canon,
    extraBooksLabel: overrides?.extraBooksLabel ?? (canon === 'catholic' ? 'deuterocanon' : 'apocrypha'),
    default: overrides?.default ?? false,
    tag,
  };
}

export function buildPublishedTranslation(
  language: LanguageDefinition,
  config: ResolvedTranslation,
  complete: CompleteTranslation,
): PublishedTranslation {
  const ui = uiStrings(language.code);
  const path = `${language.code}/${config.slug}`;

  const books: PublishedBook[] = complete.books
    .filter((book) => book.chapters.length > 0)
    .map((book) => toPublishedBook(book, path));

  const sections = config.canon === 'catholic' ? catholicSections(books, ui) : protestantSections(books, ui, config);
  const ordered = sections.flatMap((section) => section.books);
  const dir: 'ltr' | 'rtl' = complete.translation.textDirection === 'rtl' || RTL_LANGUAGES.has(language.code) ? 'rtl' : 'ltr';

  return {
    language,
    config,
    summary: complete.translation,
    ui,
    name: config.name,
    label: config.label,
    slug: config.slug,
    path,
    dir,
    books: ordered,
    sections,
    bookById: new Map(ordered.map((book) => [book.id, book])),
  };
}

function toPublishedBook(book: TranslationBook, translationPath: string): PublishedBook {
  const slug = bookSlug(book.id);
  return {
    id: book.id,
    slug,
    name: book.name.trim().length > 0 ? book.name.trim() : book.commonName,
    englishName: englishBookName(book.id),
    title: book.title && book.title.trim().length > 0 && book.title.trim() !== book.name.trim() ? book.title.trim() : null,
    section: sectionOf(book.id),
    chapters: [...book.chapters].sort((a, b) => a.number - b.number),
    totalVerses: book.totalNumberOfVerses,
    path: `${translationPath}/${slug}`,
  };
}

function byCanonicalOrder(a: PublishedBook, b: PublishedBook): number {
  return canonicalOrder(a.id) - canonicalOrder(b.id);
}

function protestantSections(books: PublishedBook[], ui: UiStrings, config: ResolvedTranslation): PublishedSection[] {
  const ot = books.filter((b) => b.section === 'ot').sort(byCanonicalOrder);
  const nt = books.filter((b) => b.section === 'nt').sort(byCanonicalOrder);
  const extra = books.filter((b) => b.section === 'extra').sort(byCanonicalOrder);
  const extraLabel = config.extraBooksLabel === 'deuterocanon' ? ui.deuterocanon : ui.apocrypha;
  const sections: PublishedSection[] = [];
  if (ot.length > 0) sections.push({ key: 'ot', label: ui.oldTestament, books: ot });
  if (nt.length > 0) sections.push({ key: 'nt', label: ui.newTestament, books: nt });
  if (extra.length > 0) sections.push({ key: 'extra', label: extraLabel, books: extra });
  return sections;
}

function catholicSections(books: PublishedBook[], ui: UiStrings): PublishedSection[] {
  const position = new Map(CATHOLIC_OLD_TESTAMENT_ORDER.map((id, index) => [id, index]));
  const ot = books
    .filter((b) => position.has(b.id))
    .sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
  const nt = books.filter((b) => b.section === 'nt').sort(byCanonicalOrder);
  const rest = books.filter((b) => !position.has(b.id) && b.section !== 'nt').sort(byCanonicalOrder);
  const sections: PublishedSection[] = [];
  if (ot.length > 0) sections.push({ key: 'ot', label: ui.oldTestament, books: ot });
  if (nt.length > 0) sections.push({ key: 'nt', label: ui.newTestament, books: nt });
  if (rest.length > 0) sections.push({ key: 'extra', label: ui.apocrypha, books: rest });
  return sections;
}

/** Path of a chapter page, e.g. `en/kjv/genesis/1`. */
export function chapterPath(book: PublishedBook, chapter: number): string {
  return `${book.path}/${chapter}`;
}

export function formatNumber(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return new Intl.NumberFormat('en').format(value);
  }
}
