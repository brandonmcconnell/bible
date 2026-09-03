/**
 * The client-side manifest tells the reader script which translations exist,
 * how books map to URL slugs, which chapters each translation has, and the UI
 * strings for each language.
 *
 * It is emitted as a `.js` file (`theme/bible-manifest.js`) because Mintlify
 * injects every `.js` file in the content directory into every page, which
 * guarantees availability in both `mint dev` and production. Because it ships
 * with every page it is kept compact: chapter lists are stored once per book
 * in `bookChapters` and translations only record deviations from them.
 */
import type { LanguageConfig } from '../config.ts';
import { allKnownBookIds, bookSlug, englishBookName, englishBookNames } from './books.ts';
import type { UiStrings } from './i18n.ts';
import { uiStrings } from './i18n.ts';
import type { PublishedTranslation } from './model.ts';

/** Chapter count when chapters run 1..n, otherwise the explicit list of chapter numbers. */
export type ChapterSpec = number | number[];

export interface ManifestBook {
  /** Localized name; omitted when identical to the English name. */
  n?: string;
  /** Chapters; omitted when identical to `Manifest.bookChapters[bookId]`. */
  c?: ChapterSpec;
}

export interface ManifestTranslation {
  id: string;
  label: string;
  name: string;
  dir: 'ltr' | 'rtl';
  /** Books in display order. Insertion order is significant. */
  books: Record<string, ManifestBook>;
}

export interface ManifestLanguage {
  name: string;
  htmlLang: string;
  default: string;
  study: string | undefined;
  ui: UiStrings;
  translations: Record<string, ManifestTranslation>;
}

export interface Manifest {
  generatedAt: string;
  /** Base URLs to try, in order, when loading `/<BOOK>/<chapter>.json` cross-reference files. */
  xrefBaseUrls: string[];
  bookSlugs: Record<string, string>;
  bookNames: Record<string, string>;
  /** The most common chapter spec for each book across all translations. */
  bookChapters: Record<string, ChapterSpec>;
  languages: Record<string, ManifestLanguage>;
}

export interface ManifestInput {
  config: LanguageConfig;
  translations: PublishedTranslation[];
  studyBasePath: string | undefined;
}

function chapterSpec(translation: PublishedTranslation, bookId: string): ChapterSpec | undefined {
  const book = translation.bookById.get(bookId);
  if (!book) return undefined;
  const numbers = book.chapters.map((c) => c.number);
  return numbers.every((n, i) => n === i + 1) ? numbers.length : numbers;
}

/** Picks the chapter spec that appears most often across translations for each book. */
function commonChapterSpecs(translations: readonly PublishedTranslation[]): Record<string, ChapterSpec> {
  const tallies = new Map<string, Map<string, { spec: ChapterSpec; count: number }>>();
  for (const translation of translations) {
    for (const book of translation.books) {
      const spec = chapterSpec(translation, book.id);
      if (spec === undefined) continue;
      const key = JSON.stringify(spec);
      const perBook = tallies.get(book.id) ?? new Map<string, { spec: ChapterSpec; count: number }>();
      const entry = perBook.get(key) ?? { spec, count: 0 };
      entry.count += 1;
      perBook.set(key, entry);
      tallies.set(book.id, perBook);
    }
  }
  const result: Record<string, ChapterSpec> = {};
  for (const [bookId, perBook] of tallies) {
    const best = [...perBook.values()].sort((a, b) => b.count - a.count)[0];
    if (best) result[bookId] = best.spec;
  }
  return result;
}

export function buildManifest(languages: readonly ManifestInput[], xrefBaseUrls: string[]): Manifest {
  const bookSlugs: Record<string, string> = {};
  for (const id of allKnownBookIds()) bookSlugs[id] = bookSlug(id);

  const allTranslations = languages.flatMap((l) => l.translations);
  const bookChapters = commonChapterSpecs(allTranslations);

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    xrefBaseUrls,
    bookSlugs,
    bookNames: englishBookNames(),
    bookChapters,
    languages: {},
  };

  for (const { config, translations, studyBasePath } of languages) {
    const defaultTranslation = translations.find((t) => t.config.default) ?? translations[0];
    if (!defaultTranslation) continue;
    const entry: ManifestLanguage = {
      name: config.name,
      htmlLang: config.htmlLang,
      default: defaultTranslation.slug,
      study: studyBasePath,
      ui: uiStrings(config.code),
      translations: {},
    };
    for (const translation of translations) {
      const books: Record<string, ManifestBook> = {};
      for (const book of translation.books) {
        const manifestBook: ManifestBook = {};
        if (book.name !== englishBookName(book.id)) manifestBook.n = book.name;
        const spec = chapterSpec(translation, book.id);
        if (spec !== undefined && JSON.stringify(spec) !== JSON.stringify(bookChapters[book.id])) manifestBook.c = spec;
        if (bookSlugs[book.id] === undefined) bookSlugs[book.id] = book.slug;
        books[book.id] = manifestBook;
      }
      entry.translations[translation.slug] = {
        id: translation.summary.id,
        label: translation.label,
        name: translation.name,
        dir: translation.dir,
        books,
      };
    }
    manifest.languages[config.code] = entry;
  }
  return manifest;
}

/** Serializes the manifest as a script that publishes it on `window` and announces it. */
export function manifestScript(manifest: Manifest): string {
  return [
    '/* Generated by generator/build.ts — do not edit. */',
    `window.BIBLE_MANIFEST = ${JSON.stringify(manifest)};`,
    "document.dispatchEvent(new CustomEvent('bible:manifest'));",
    '',
  ].join('\n');
}
