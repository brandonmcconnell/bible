/**
 * Site configuration: which languages and translations to publish, and where
 * the generated output goes. Everything else is derived from the API.
 *
 * To add a translation, look up its id in
 * https://bible.helloao.org/api/available_translations.json and add an entry
 * to the matching language (or a new language) below, then run `npm run build`.
 */
import type { MintlifyLanguage } from './lib/i18n.ts';

export type Canon = 'protestant' | 'catholic';

export interface TranslationConfig {
  /** Translation id in the Free Use Bible API, e.g. `eng_kjv`. */
  id: string;
  /** URL segment for this translation, e.g. `kjv` → `/en/kjv/genesis/1`. */
  slug: string;
  /** Short label shown in the version switcher, e.g. `KJV`. */
  label: string;
  /** Optional override for the display name (defaults to the API's `name`). */
  name?: string;
  /**
   * How to arrange books that fall outside the 66-book Protestant canon.
   * - `protestant` (default): extra books go into a separate Apocrypha/Deuterocanon group.
   * - `catholic`: deuterocanonical books are interleaved into the Old Testament in Catholic order.
   */
  canon?: Canon;
  /** Label to use for the extra-books group when `canon` is `protestant`. */
  extraBooksLabel?: 'apocrypha' | 'deuterocanon';
  /** Marks the default translation for its language. */
  default?: boolean;
  /** Optional badge shown next to the version in the switcher, e.g. `Apocrypha`. */
  tag?: string;
}

export interface LanguageConfig {
  /** Mintlify language code; also the first URL segment. */
  code: MintlifyLanguage;
  /** Human readable language name in its own language. */
  name: string;
  /** BCP 47 tag written to the `lang` attribute of scripture containers. */
  htmlLang: string;
  translations: TranslationConfig[];
  /** Include the Theographic study section (people, places, events). English-only data. */
  study?: boolean;
}

export interface SiteConfig {
  languages: LanguageConfig[];
  /** Generate `/data/xref/<BOOK>/<chapter>.json` cross-reference files. */
  crossReferences: boolean;
  /** Maximum concurrent API requests. */
  concurrency: number;
  /** Directory for cached API responses (git-ignored). */
  cacheDir: string;
  /** Where generated navigation JSON files are written. */
  navigationDir: string;
  /** Where generated data files (manifest, cross references) are written. */
  dataDir: string;
  /** Dataset ids in the Free Use Bible API. */
  datasets: { crossReferences: string; entities: string };
  /** Public repository URL, used for footer/navbar links. */
  repositoryUrl: string;
  /**
   * CDN mirror of this repository, used as a fallback for loading the
   * cross-reference JSON files when the docs host does not serve them.
   */
  cdnBaseUrl: string;
}

export const siteConfig: SiteConfig = {
  crossReferences: true,
  concurrency: 12,
  cacheDir: '.cache/helloao',
  navigationDir: 'navigation',
  dataDir: 'data',
  datasets: { crossReferences: 'open-cross-ref', entities: 'theographic' },
  repositoryUrl: 'https://github.com/brandonmcconnell/bible',
  cdnBaseUrl: 'https://cdn.jsdelivr.net/gh/brandonmcconnell/bible@main',
  languages: [
    {
      code: 'en',
      name: 'English',
      htmlLang: 'en',
      study: true,
      translations: [
        { id: 'eng_kjv', slug: 'kjv', label: 'KJV', name: 'King James Version', default: true },
        { id: 'eng_kja', slug: 'kjva', label: 'KJVA', name: 'King James Version with Apocrypha', tag: 'Apocrypha', extraBooksLabel: 'apocrypha' },
        { id: 'ENGWEBP', slug: 'web', label: 'WEB', name: 'World English Bible' },
        { id: 'eng_asv', slug: 'asv', label: 'ASV', name: 'American Standard Version' },
        { id: 'BSB', slug: 'bsb', label: 'BSB', name: 'Berean Standard Bible' },
        { id: 'eng_dra', slug: 'dra', label: 'DRA', name: 'Douay-Rheims 1899', canon: 'catholic', tag: 'Catholic' },
      ],
    },
    {
      code: 'es',
      name: 'Español',
      htmlLang: 'es',
      translations: [{ id: 'spa_r09', slug: 'rvr1909', label: 'RVR 1909', name: 'Reina Valera 1909', default: true }],
    },
    {
      code: 'fr',
      name: 'Français',
      htmlLang: 'fr',
      translations: [{ id: 'fra_lsg', slug: 'lsg', label: 'LSG', name: 'Louis Segond 1910', default: true }],
    },
    {
      code: 'de',
      name: 'Deutsch',
      htmlLang: 'de',
      translations: [{ id: 'deu_l12', slug: 'luther1912', label: 'Luther 1912', name: 'Lutherbibel 1912', default: true }],
    },
    {
      code: 'pt-BR',
      name: 'Português',
      htmlLang: 'pt-BR',
      translations: [{ id: 'por_blj', slug: 'blivre', label: 'Bíblia Livre', name: 'Bíblia Livre', default: true }],
    },
    {
      code: 'ru',
      name: 'Русский',
      htmlLang: 'ru',
      translations: [{ id: 'rus_syn', slug: 'synodal', label: 'Синодальный', name: 'Синодальный перевод', default: true }],
    },
    {
      code: 'zh-Hans',
      name: '简体中文',
      htmlLang: 'zh-Hans',
      translations: [{ id: 'cmn_cu1', slug: 'cuvs', label: '和合本', name: '新标点和合本', default: true }],
    },
    {
      code: 'ko',
      name: '한국어',
      htmlLang: 'ko',
      translations: [{ id: 'kor_old', slug: 'krv1910', label: '개역 (1910)', name: '한국어 성경 (1910)', default: true }],
    },
    {
      code: 'he',
      name: 'עברית',
      htmlLang: 'he',
      translations: [{ id: 'heb_mod', slug: 'modern', label: 'עברית מודרנית', name: 'תנ״ך עברי מודרני', default: true }],
    },
    {
      code: 'ar',
      name: 'العربية',
      htmlLang: 'ar',
      translations: [{ id: 'arb_vdv', slug: 'vandyck', label: 'فان دايك', name: 'الكتاب المقدس – ترجمة فان دايك', default: true }],
    },
  ],
};
