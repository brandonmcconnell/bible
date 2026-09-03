/**
 * Mintlify `docs.json` navigation types and builders.
 *
 * Structure: languages → versions (one per translation) → tabs → groups →
 * pages. Each book is a nested group whose `root` is the book landing page and
 * whose pages are its chapters.
 */
import type { MintlifyLanguage } from './i18n.ts';
import type { PublishedTranslation } from './model.ts';
import { chapterPath } from './model.ts';

export type NavPage = string | NavGroup;

export interface NavGroup {
  group: string;
  icon?: string;
  root?: string;
  expanded?: boolean;
  tag?: string;
  pages: NavPage[];
}

export interface NavTab {
  tab: string;
  icon?: string;
  href?: string;
  groups?: NavGroup[];
  pages?: NavPage[];
}

export interface NavVersion {
  version: string;
  default?: boolean;
  tag?: string;
  tabs: NavTab[];
}

export interface NavLanguage {
  language: MintlifyLanguage;
  default?: boolean;
  versions: NavVersion[];
}

export interface NavRef {
  $ref: string;
}

export interface Redirect {
  source: string;
  destination: string;
  permanent?: boolean;
}

const SECTION_ICONS = { ot: 'scroll-text', nt: 'cross', extra: 'book-copy' } as const;

/** Builds the "Bible" tab for a translation: sections → books → chapters. */
export function buildBibleTab(translation: PublishedTranslation): NavTab {
  const groups: NavGroup[] = [
    { group: translation.name, icon: 'book-open', pages: [`${translation.path}/index`] },
  ];
  for (const section of translation.sections) {
    groups.push({
      group: section.label,
      icon: SECTION_ICONS[section.key],
      pages: section.books.map((book) => ({
        group: book.name,
        root: `${book.path}/index`,
        pages: book.chapters.map((chapter) => chapterPath(book, chapter.number)),
      })),
    });
  }
  return { tab: translation.ui.bible, icon: 'book-open', groups };
}

export function buildVersion(translation: PublishedTranslation, extraTabs: NavTab[]): NavVersion {
  const version: NavVersion = {
    version: translation.label,
    tabs: [buildBibleTab(translation), ...extraTabs],
  };
  if (translation.config.default) version.default = true;
  if (translation.config.tag) version.tag = translation.config.tag;
  return version;
}
