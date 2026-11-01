/**
 * The client-side manifest tells the reader script which translations exist,
 * how books map to URL slugs, which chapters each translation has, and the UI
 * strings for each language.
 *
 * It is emitted as a `.js` file (`theme/bible-manifest.js`) because Mintlify
 * injects every `.js` file in the content directory into every page, which
 * guarantees availability in both `mint dev` and production. Because it ships
 * with every page it is kept compact:
 *  - `bookChapters` holds the most common chapter spec per book; translations
 *    only list their book ids (`b`) and deviations (`x`);
 *  - localized book names are stored once per language (`bookNames`, taken
 *    from the default translation) rather than per translation.
 */
import type { LanguageDefinition } from '../config.ts';
import { allKnownBookIds, bookSlug, englishBookName, englishBookNames } from './books.ts';
import type { UiStrings } from './i18n.ts';
import { uiStrings } from './i18n.ts';
import type { PublishedTranslation } from './model.ts';

/** Chapter count when chapters run 1..n, otherwise the explicit list of chapter numbers. */
export type ChapterSpec = number | number[];

export interface ManifestLive {
  provider: string;
  edition: string;
  copyright: string;
  url: string;
}

export interface ManifestTranslation {
  id: string;
  label: string;
  name: string;
  dir: 'ltr' | 'rtl';
  /** Present for licensed translations whose text is fetched from the proxy. */
  live?: ManifestLive;
  /** Book ids in display order, or the key of a shared list in `Manifest.bookSets`. */
  b: string[] | string;
  /** Chapter specs that differ from `Manifest.bookChapters`. */
  x?: Record<string, ChapterSpec>;
}

export interface ManifestLanguage {
  name: string;
  htmlLang: string;
  default: string;
  study: string | undefined;
  commentary: string | undefined;
  ui: UiStrings;
  /** Localized book names (from the default translation) that differ from English. */
  bookNames: Record<string, string>;
  translations: Record<string, ManifestTranslation>;
}

export interface Manifest {
  generatedAt: string;
  /** Base URL of the proxy that serves licensed translations; empty when not configured. */
  liveProxyUrl: string;
  /** Base URLs to try, in order, when loading `/<BOOK>/<chapter>.json` cross-reference files. */
  xrefBaseUrls: string[];
  bookSlugs: Record<string, string>;
  bookNames: Record<string, string>;
  /** The most common chapter spec for each book across all translations. */
  bookChapters: Record<string, ChapterSpec>;
  /** Book lists shared by several translations (e.g. the 66-book Protestant canon). */
  bookSets: Record<string, string[]>;
  languages: Record<string, ManifestLanguage>;
}

export interface ManifestInput {
  config: LanguageDefinition;
  translations: PublishedTranslation[];
  studyBasePath: string | undefined;
  commentaryBasePath: string | undefined;
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

export function buildManifest(languages: readonly ManifestInput[], xrefBaseUrls: string[], liveProxyUrl: string): Manifest {
  const bookSlugs: Record<string, string> = {};
  for (const id of allKnownBookIds()) bookSlugs[id] = bookSlug(id);

  const allTranslations = languages.flatMap((l) => l.translations);
  const bookChapters = commonChapterSpecs(allTranslations);

  // Book lists used by more than one translation are stored once.
  const bookListCounts = new Map<string, number>();
  for (const translation of allTranslations) {
    const key = translation.books.map((b) => b.id).join(',');
    bookListCounts.set(key, (bookListCounts.get(key) ?? 0) + 1);
  }
  const bookSetIds = new Map<string, string>();
  const bookSets: Record<string, string[]> = {};
  for (const [key, count] of [...bookListCounts.entries()].sort((a, b) => b[1] - a[1])) {
    if (count < 2) continue;
    const id = `s${bookSetIds.size}`;
    bookSetIds.set(key, id);
    bookSets[id] = key.split(',');
  }

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    liveProxyUrl,
    xrefBaseUrls,
    bookSlugs,
    bookNames: englishBookNames(),
    bookChapters,
    bookSets,
    languages: {},
  };

  for (const { config, translations, studyBasePath, commentaryBasePath } of languages) {
    const defaultTranslation = translations.find((t) => t.config.default) ?? translations[0];
    if (!defaultTranslation) continue;
    const bookNames: Record<string, string> = {};
    for (const book of defaultTranslation.books) {
      if (book.name !== englishBookName(book.id)) bookNames[book.id] = book.name;
    }
    const entry: ManifestLanguage = {
      name: config.name,
      htmlLang: config.htmlLang,
      default: defaultTranslation.slug,
      study: studyBasePath,
      commentary: commentaryBasePath,
      ui: uiStrings(config.code),
      bookNames,
      translations: {},
    };
    for (const translation of translations) {
      const deviations: Record<string, ChapterSpec> = {};
      for (const book of translation.books) {
        const spec = chapterSpec(translation, book.id);
        if (spec !== undefined && JSON.stringify(spec) !== JSON.stringify(bookChapters[book.id])) deviations[book.id] = spec;
        if (bookSlugs[book.id] === undefined) bookSlugs[book.id] = book.slug;
      }
      const bookIds = translation.books.map((book) => book.id);
      const manifestTranslation: ManifestTranslation = {
        id: translation.summary.id,
        label: translation.label,
        name: translation.name,
        dir: translation.dir,
        b: bookSetIds.get(bookIds.join(',')) ?? bookIds,
      };
      if (Object.keys(deviations).length > 0) manifestTranslation.x = deviations;
      if (translation.live) {
        manifestTranslation.live = {
          provider: translation.live.provider,
          edition: translation.live.edition,
          copyright: translation.live.copyright,
          url: translation.live.website,
        };
      }
      entry.translations[translation.slug] = manifestTranslation;
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
