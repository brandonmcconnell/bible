/**
 * Build entry point. Fetches every configured translation from the Free Use
 * Bible API and generates the whole Mintlify site: MDX pages for every
 * chapter, book and translation, navigation JSON, `docs.json`, the client
 * manifest, cross-reference data and the study section.
 *
 *   npm run build              # full build
 *   npm run build:sample       # a handful of books/chapters for quick iteration
 *   npm run build -- --no-study --no-xref --translations=eng_kjv,BSB
 */
import { join } from 'node:path';
import { siteConfig, type LanguageConfig, type TranslationConfig } from './config.ts';
import { ensureDir, removePath, writeText } from './lib/fs.ts';
import { HelloAoClient, type CompleteTranslation, type EntityChapter } from './lib/helloao.ts';
import { uiStrings } from './lib/i18n.ts';
import { buildManifest, manifestScript } from './lib/manifest.ts';
import { buildPublishedTranslation, chapterPath, formatNumber, type PublishedTranslation } from './lib/model.ts';
import { buildVersion, type NavLanguage, type NavRef, type NavTab, type Redirect } from './lib/nav.ts';
import { renderBookPage, renderChapterPage, renderTranslationPage } from './lib/render.ts';
import { buildStudySection } from './lib/study.ts';
import { buildCrossReferences, crossRefKey, type CrossRefIndex } from './lib/xref.ts';
import { docsBase, REPOSITORY_URL, type DocsJson } from './site.ts';

interface CliOptions {
  sample: boolean;
  cleanOnly: boolean;
  study: boolean;
  crossReferences: boolean;
  /** Restrict the build to these translation ids (comma separated on the CLI). */
  translations: Set<string> | undefined;
  /** Inline navigation into docs.json instead of using `$ref` files. */
  inlineNavigation: boolean;
}

const SAMPLE_BOOKS = new Set(['GEN', 'PSA', 'MAT', 'JHN', 'TOB', '1MA']);
const SAMPLE_MAX_CHAPTER = 3;
const SAMPLE_LANGUAGES = new Set(['en', 'es', 'he']);
const MANIFEST_SCRIPT_PATH = 'theme/bible-manifest.js';

function parseCli(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    sample: false,
    cleanOnly: false,
    study: true,
    crossReferences: siteConfig.crossReferences,
    translations: undefined,
    inlineNavigation: false,
  };
  for (const arg of argv) {
    if (arg === '--sample') options.sample = true;
    else if (arg === '--clean-only') options.cleanOnly = true;
    else if (arg === '--no-study') options.study = false;
    else if (arg === '--no-xref') options.crossReferences = false;
    else if (arg === '--inline-navigation') options.inlineNavigation = true;
    else if (arg.startsWith('--translations=')) {
      options.translations = new Set(arg.slice('--translations='.length).split(',').map((s) => s.trim()).filter(Boolean));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function restrictToSample(complete: CompleteTranslation): CompleteTranslation {
  return {
    translation: complete.translation,
    books: complete.books
      .filter((book) => SAMPLE_BOOKS.has(book.id))
      .map((book) => ({ ...book, chapters: book.chapters.filter((chapter) => chapter.number <= SAMPLE_MAX_CHAPTER) })),
  };
}

async function cleanOutputs(languages: readonly LanguageConfig[]): Promise<void> {
  const targets = new Set<string>([siteConfig.navigationDir, siteConfig.dataDir, 'docs.json', MANIFEST_SCRIPT_PATH]);
  for (const language of languages) targets.add(language.code);
  for (const target of targets) await removePath(target);
}

interface LanguageBuild {
  config: LanguageConfig;
  translations: PublishedTranslation[];
  studyBasePath: string | undefined;
  studyTab: NavTab | undefined;
  chapterEntities: Map<string, EntityChapter>;
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const started = Date.now();

  log('Cleaning generated output…');
  await cleanOutputs(siteConfig.languages);
  if (options.cleanOnly) return;

  const client = new HelloAoClient({ cacheDir: siteConfig.cacheDir, concurrency: siteConfig.concurrency });

  const languages = siteConfig.languages.filter((language) => !options.sample || SAMPLE_LANGUAGES.has(language.code));
  const builds: LanguageBuild[] = [];
  let pageCount = 0;

  // -------------------------------------------------------------------------
  // 1. Fetch and model every translation
  // -------------------------------------------------------------------------
  for (const language of languages) {
    const selected = language.translations.filter((t) => !options.translations || options.translations.has(t.id));
    if (selected.length === 0) continue;
    const published: PublishedTranslation[] = [];
    for (const translationConfig of selected) {
      log(`Fetching ${translationConfig.id} (${language.code}/${translationConfig.slug})…`);
      const complete = await client.completeTranslation(translationConfig.id);
      const model = buildPublishedTranslation(language, translationConfig, options.sample ? restrictToSample(complete) : complete);
      published.push(model);
    }
    ensureDefault(published, selected);
    builds.push({
      config: language,
      translations: published,
      studyBasePath: options.study && language.study ? `${language.code}/study` : undefined,
      studyTab: undefined,
      chapterEntities: new Map(),
    });
  }

  // -------------------------------------------------------------------------
  // 2. Cross references (shared by every translation)
  // -------------------------------------------------------------------------
  let crossRefs: CrossRefIndex = new Map();
  if (options.crossReferences) {
    log('Building cross references…');
    let lastReported = 0;
    const result = await buildCrossReferences(
      client,
      siteConfig.datasets.crossReferences,
      join(siteConfig.dataDir, 'xref'),
      siteConfig.concurrency,
      options.sample ? (bookId, chapter) => SAMPLE_BOOKS.has(bookId) && chapter <= SAMPLE_MAX_CHAPTER : undefined,
      (done, total) => {
        if (done - lastReported >= 250 || done === total) {
          lastReported = done;
          log(`  ${done}/${total} chapters`);
        }
      },
    );
    crossRefs = result.index;
    log(`  ${formatNumber(result.references, 'en')} cross references in ${formatNumber(result.files, 'en')} files`);
  }

  // -------------------------------------------------------------------------
  // 3. Study section (per language that opts in)
  // -------------------------------------------------------------------------
  for (const build of builds) {
    if (!build.studyBasePath) continue;
    const linkTranslation = build.translations.find((t) => t.config.default) ?? build.translations[0];
    if (!linkTranslation) continue;
    log(`Building study section for ${build.config.code}…`);
    const result = await buildStudySection({
      client,
      datasetId: siteConfig.datasets.entities,
      basePath: build.studyBasePath,
      linkTranslation,
      ui: uiStrings(build.config.code),
      concurrency: siteConfig.concurrency,
      limitEntities: options.sample ? 40 : undefined,
      onProgress: (message) => log(`  ${message}`),
    });
    build.studyTab = result.tab;
    build.chapterEntities = result.chapterEntities;
    pageCount += result.pages;
    log(`  ${formatNumber(result.pages, 'en')} study pages`);
  }

  // -------------------------------------------------------------------------
  // 4. Scripture pages
  // -------------------------------------------------------------------------
  for (const build of builds) {
    for (const translation of build.translations) {
      let pages = 0;
      for (const book of translation.books) {
        await writeText(`${book.path}/index.mdx`, renderBookPage(translation, book));
        pages += 1;
        for (const chapter of book.chapters) {
          const key = crossRefKey(book.id, chapter.number);
          const mdx = renderChapterPage(translation, book, chapter, {
            entities: build.studyBasePath ? build.chapterEntities.get(key) : undefined,
            studyBasePath: build.studyBasePath ? `/${build.studyBasePath}` : undefined,
            crossRefs: crossRefs.get(key),
          });
          await writeText(`${chapterPath(book, chapter.number)}.mdx`, mdx);
          pages += 1;
        }
      }
      const siblings = build.translations.filter((t) => t !== translation);
      await writeText(
        `${translation.path}/index.mdx`,
        renderTranslationPage(translation, siblings, build.studyBasePath ? `/${build.studyBasePath}` : undefined, REPOSITORY_URL),
      );
      pages += 1;
      pageCount += pages;
      log(`Rendered ${formatNumber(pages, 'en')} pages for ${translation.name} (${translation.path})`);
    }
  }

  // -------------------------------------------------------------------------
  // 5. Navigation, docs.json, manifest
  // -------------------------------------------------------------------------
  const redirects: Redirect[] = [];
  const navLanguages: Array<NavLanguage | NavRef> = [];
  let firstLanguage = true;
  for (const build of builds) {
    const defaultTranslation = build.translations.find((t) => t.config.default) ?? build.translations[0];
    if (!defaultTranslation) continue;
    redirects.push({ source: `/${build.config.code}`, destination: `/${defaultTranslation.path}` });

    const versions = build.translations.map((translation) => {
      const extraTabs: NavTab[] = [];
      if (build.studyTab && build.studyBasePath) {
        extraTabs.push(
          translation === defaultTranslation
            ? build.studyTab
            : { tab: build.studyTab.tab, icon: build.studyTab.icon ?? 'library', href: `/${build.studyBasePath}` },
        );
      }
      return buildVersion(translation, extraTabs);
    });

    const navLanguage: NavLanguage = { language: build.config.code, versions };
    if (firstLanguage) {
      navLanguage.default = true;
      firstLanguage = false;
    }

    if (options.inlineNavigation) {
      navLanguages.push(navLanguage);
    } else {
      const file = `${siteConfig.navigationDir}/${build.config.code}.json`;
      await writeText(file, `${JSON.stringify(navLanguage, null, 2)}\n`);
      navLanguages.push({ $ref: `./${file}` });
    }
  }

  const docs: DocsJson = { ...docsBase, redirects, navigation: { languages: navLanguages } };
  await writeText('docs.json', `${JSON.stringify(docs, null, 2)}\n`);

  await ensureDir(siteConfig.dataDir);
  const xrefBaseUrls = options.crossReferences ? ['/data/xref', `${siteConfig.cdnBaseUrl}/data/xref`] : [];
  const manifest = buildManifest(
    builds.map((build) => ({
      config: build.config,
      translations: build.translations,
      studyBasePath: build.studyBasePath ? `/${build.studyBasePath}` : undefined,
    })),
    xrefBaseUrls,
  );
  await writeText(MANIFEST_SCRIPT_PATH, manifestScript(manifest));

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const translationCount = builds.reduce((n, b) => n + b.translations.length, 0);
  log(`Done: ${formatNumber(pageCount, 'en')} pages across ${translationCount} translations in ${seconds}s`);
}

function ensureDefault(published: PublishedTranslation[], configs: readonly TranslationConfig[]): void {
  if (published.some((t) => t.config.default)) return;
  const first = published[0];
  const firstConfig = configs[0];
  if (first && firstConfig) first.config.default = true;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
