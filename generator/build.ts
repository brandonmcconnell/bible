/**
 * Build entry point. Discovers every translation the Free Use Bible API offers
 * in a language Mintlify can represent, then generates the whole site: MDX
 * pages for every chapter, book and translation, commentaries, the study
 * section, navigation JSON, `docs.json`, the client manifest and
 * cross-reference data.
 *
 *   npm run build              # full build
 *   npm run build:sample       # a handful of books/chapters for quick iteration
 *   npm run build -- --no-study --no-xref --no-commentaries --translations=eng_kjv,BSB
 */
import { join } from 'node:path';
import { siteConfig, type LanguageDefinition } from './config.ts';
import { buildCommentaries, type CommentaryLink } from './lib/commentary.ts';
import { ensureDir, mapConcurrent, removePath, writeText } from './lib/fs.ts';
import { HelloAoClient, type CompleteTranslation, type EntityChapter, type TranslationSummary } from './lib/helloao.ts';
import { uiStrings, type MintlifyLanguage } from './lib/i18n.ts';
import { buildManifest, manifestScript } from './lib/manifest.ts';
import {
  buildLiveTranslation,
  buildPublishedTranslation,
  chapterPath,
  formatNumber,
  resolveTranslation,
  type PublishedTranslation,
  type ResolvedTranslation,
} from './lib/model.ts';
import { buildVersion, linkTab, type NavLanguage, type NavRef, type NavTab, type Redirect } from './lib/nav.ts';
import { renderBookPage, renderChapterPage, renderTranslationPage } from './lib/render.ts';
import { buildStudySection } from './lib/study.ts';
import { buildCrossReferences, crossRefKey, type CrossRefIndex } from './lib/xref.ts';
import { docsBase, REPOSITORY_URL, type DocsJson } from './site.ts';
import { slugify } from './lib/mdx.ts';

interface CliOptions {
  sample: boolean;
  cleanOnly: boolean;
  study: boolean;
  commentaries: boolean;
  crossReferences: boolean;
  /** Restrict the build to these translation ids (comma separated on the CLI). */
  translations: Set<string> | undefined;
  /** Inline navigation into docs.json instead of using `$ref` files. */
  inlineNavigation: boolean;
}

const SAMPLE_BOOKS = new Set(['GEN', 'PSA', 'MAT', 'JHN', 'TOB', '1MA']);
const SAMPLE_MAX_CHAPTER = 3;
const SAMPLE_LANGUAGES = new Set<MintlifyLanguage>(['en', 'es', 'he']);
const SAMPLE_TRANSLATIONS_PER_LANGUAGE = 4;
const MANIFEST_SCRIPT_PATH = 'theme/bible-manifest.js';

function parseCli(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    sample: false,
    cleanOnly: false,
    study: true,
    commentaries: true,
    crossReferences: siteConfig.crossReferences,
    translations: undefined,
    inlineNavigation: false,
  };
  for (const arg of argv) {
    if (arg === '--sample') options.sample = true;
    else if (arg === '--clean-only') options.cleanOnly = true;
    else if (arg === '--no-study') options.study = false;
    else if (arg === '--no-commentaries') options.commentaries = false;
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

function sampleFilter(bookId: string, chapter: number): boolean {
  return SAMPLE_BOOKS.has(bookId) && chapter <= SAMPLE_MAX_CHAPTER;
}

function restrictToSample(complete: CompleteTranslation): CompleteTranslation {
  return {
    translation: complete.translation,
    books: complete.books
      .filter((book) => SAMPLE_BOOKS.has(book.id))
      .map((book) => ({ ...book, chapters: book.chapters.filter((chapter) => chapter.number <= SAMPLE_MAX_CHAPTER) })),
  };
}

async function cleanOutputs(languages: readonly LanguageDefinition[]): Promise<void> {
  const targets = new Set<string>([siteConfig.navigationDir, siteConfig.dataDir, 'docs.json', MANIFEST_SCRIPT_PATH]);
  for (const language of languages) targets.add(language.code);
  for (const target of targets) await removePath(target);
}

interface LanguageBuild {
  config: LanguageDefinition;
  translations: PublishedTranslation[];
  studyBasePath: string | undefined;
  studyTab: NavTab | undefined;
  commentaryBasePath: string | undefined;
  commentaryTab: NavTab | undefined;
  commentaryLinks: Map<string, CommentaryLink[]>;
  chapterEntities: Map<string, EntityChapter>;
}

// ---------------------------------------------------------------------------
// Discovery: map every API translation to a Mintlify language
// ---------------------------------------------------------------------------

interface Discovered {
  byLanguage: Map<MintlifyLanguage, TranslationSummary[]>;
  skipped: TranslationSummary[];
}

function discoverTranslations(summaries: readonly TranslationSummary[], languages: readonly LanguageDefinition[], options: CliOptions): Discovered {
  const byIso = new Map<string, LanguageDefinition>();
  for (const language of languages) for (const iso of language.iso) byIso.set(iso, language);
  const byCode = new Map(languages.map((l) => [l.code, l]));

  const byLanguage = new Map<MintlifyLanguage, TranslationSummary[]>();
  const skipped: TranslationSummary[] = [];
  for (const summary of summaries) {
    const overrides = siteConfig.curated[summary.id];
    if (overrides?.exclude) continue;
    if (options.translations && !options.translations.has(summary.id)) continue;
    if (summary.numberOfBooks < siteConfig.minBooks) continue;
    const language = overrides?.language ? byCode.get(overrides.language) : byIso.get(summary.language);
    if (!language) {
      skipped.push(summary);
      continue;
    }
    const list = byLanguage.get(language.code) ?? [];
    list.push(summary);
    byLanguage.set(language.code, list);
  }
  return { byLanguage, skipped };
}

/** Default first, then complete translations alphabetically, then partial ones. */
function orderTranslations(translations: PublishedTranslation[]): PublishedTranslation[] {
  // Default first, then complete translations, then licensed ones, then partial translations.
  const rank = (t: PublishedTranslation): number => (t.live ? 1 : t.books.length >= 66 ? 0 : 2);
  return [...translations].sort((a, b) => {
    if (a.config.default !== b.config.default) return a.config.default ? -1 : 1;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return a.label.localeCompare(b.label, 'en', { numeric: true });
  });
}

/** Ensures exactly one default per language: explicit, else the most complete translation. */
function ensureDefault(translations: PublishedTranslation[]): void {
  const explicit = translations.filter((t) => t.config.default);
  if (explicit.length === 1) return;
  for (const t of translations) t.config.default = false;
  const best = [...translations].sort((a, b) => {
    if (a.books.length !== b.books.length) return b.books.length - a.books.length;
    return b.summary.totalNumberOfVerses - a.summary.totalNumberOfVerses;
  })[0];
  if (best) best.config.default = true;
}

/** Slugs must be unique within a language; collisions fall back to the API id. */
function uniqueSlug(resolved: ResolvedTranslation, taken: Set<string>): string {
  let slug = resolved.slug;
  if (taken.has(slug)) slug = slugify(resolved.id);
  let suffix = 2;
  while (taken.has(slug)) {
    slug = `${slugify(resolved.id)}-${suffix}`;
    suffix += 1;
  }
  taken.add(slug);
  return slug;
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const started = Date.now();

  log('Cleaning generated output…');
  await cleanOutputs(siteConfig.languages);
  if (options.cleanOnly) return;

  const client = new HelloAoClient({ cacheDir: siteConfig.cacheDir, concurrency: siteConfig.concurrency });

  // -------------------------------------------------------------------------
  // 1. Discover, fetch and model every translation
  // -------------------------------------------------------------------------
  log('Discovering translations…');
  const summaries = await client.availableTranslations();
  const languages = siteConfig.languages.filter((language) => !options.sample || SAMPLE_LANGUAGES.has(language.code));
  const discovered = discoverTranslations(summaries, languages, options);
  const skippedLanguages = new Set(discovered.skipped.map((s) => s.language));
  log(`  ${summaries.length} translations in the API; ${discovered.skipped.length} in ${skippedLanguages.size} languages Mintlify cannot represent were skipped`);

  const builds: LanguageBuild[] = [];
  let pageCount = 0;

  for (const language of languages) {
    let selected = discovered.byLanguage.get(language.code) ?? [];
    if (selected.length === 0) continue;
    if (options.sample) {
      const curatedFirst = [...selected].sort((a, b) => Number(Boolean(siteConfig.curated[b.id]?.default)) - Number(Boolean(siteConfig.curated[a.id]?.default)));
      selected = curatedFirst.slice(0, SAMPLE_TRANSLATIONS_PER_LANGUAGE);
    }
    log(`Fetching ${selected.length} translation(s) for ${language.code}…`);
    const completes = await mapConcurrent(selected, 4, (summary) => client.completeTranslation(summary.id));

    const taken = new Set<string>();
    const published: PublishedTranslation[] = [];
    completes.forEach((complete, index) => {
      const summary = selected[index];
      if (!summary) return;
      // Tags and canon are derived from the full book list even in sample builds.
      const bookIds = complete.books.filter((b) => b.chapters.length > 0).map((b) => b.id);
      if (bookIds.length === 0) return;
      const resolved = resolveTranslation(summary, siteConfig.curated[summary.id], bookIds);
      resolved.slug = uniqueSlug(resolved, taken);
      const model = buildPublishedTranslation(language, resolved, options.sample ? restrictToSample(complete) : complete);
      if (model.books.length > 0) published.push(model);
    });
    if (published.length === 0) continue;
    ensureDefault(published);

    // Licensed translations: navigation only, text fetched live from the proxy.
    for (const licensed of language.licensed ?? []) {
      if (options.translations && !options.translations.has(licensed.slug)) continue;
      if (taken.has(licensed.slug)) throw new Error(`Licensed translation slug "${licensed.slug}" collides with an API translation in ${language.code}`);
      taken.add(licensed.slug);
      const structure = await client.completeTranslation(licensed.structureFrom ?? 'eng_kjv');
      published.push(buildLiveTranslation(language, licensed, options.sample ? restrictToSample(structure) : structure));
    }

    builds.push({
      config: language,
      translations: orderTranslations(published),
      studyBasePath: options.study && language.study ? `${language.code}/study` : undefined,
      studyTab: undefined,
      commentaryBasePath: options.commentaries && language.commentaries ? `${language.code}/commentary` : undefined,
      commentaryTab: undefined,
      commentaryLinks: new Map(),
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
      options.sample ? sampleFilter : undefined,
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
  // 3. Study section and commentaries (per language that opts in)
  // -------------------------------------------------------------------------
  for (const build of builds) {
    const linkTranslation = build.translations.find((t) => t.config.default) ?? build.translations[0];
    if (!linkTranslation) continue;
    const ui = uiStrings(build.config.code);

    if (build.studyBasePath) {
      log(`Building study section for ${build.config.code}…`);
      const result = await buildStudySection({
        client,
        datasetId: siteConfig.datasets.entities,
        basePath: build.studyBasePath,
        linkTranslation,
        ui,
        concurrency: siteConfig.concurrency,
        limitEntities: options.sample ? 40 : undefined,
        onProgress: (message) => log(`  ${message}`),
      });
      build.studyTab = result.tab;
      build.chapterEntities = result.chapterEntities;
      pageCount += result.pages;
      log(`  ${formatNumber(result.pages, 'en')} study pages`);
    }

    if (build.commentaryBasePath && build.config.commentaries) {
      log(`Building commentaries for ${build.config.code}…`);
      const result = await buildCommentaries({
        client,
        language: build.config,
        selection: options.sample ? ['matthew-henry', 'jamieson-fausset-brown'] : build.config.commentaries,
        basePath: build.commentaryBasePath,
        linkTranslation,
        ui,
        concurrency: siteConfig.concurrency,
        filter: options.sample ? sampleFilter : undefined,
        onProgress: (message) => log(`  ${message}`),
      });
      build.commentaryTab = result.tab;
      build.commentaryLinks = result.chapterLinks;
      pageCount += result.pages;
      log(`  ${formatNumber(result.pages, 'en')} commentary pages`);
    }
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
            commentaries: build.commentaryLinks.get(key),
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
      const isDefault = translation === defaultTranslation;
      if (build.studyTab && build.studyBasePath) {
        extraTabs.push(isDefault ? build.studyTab : linkTab(build.studyTab, `/${build.studyBasePath}`));
      }
      if (build.commentaryTab && build.commentaryBasePath) {
        extraTabs.push(isDefault ? build.commentaryTab : linkTab(build.commentaryTab, `/${build.commentaryBasePath}`));
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
      commentaryBasePath: build.commentaryBasePath ? `/${build.commentaryBasePath}` : undefined,
    })),
    xrefBaseUrls,
    siteConfig.liveProxyUrl,
  );
  const liveCount = builds.reduce((n, b) => n + b.translations.filter((t) => t.live).length, 0);
  if (liveCount > 0) {
    log(
      siteConfig.liveProxyUrl
        ? `${liveCount} licensed translation(s) will load from ${siteConfig.liveProxyUrl}`
        : `${liveCount} licensed translation(s) generated without a proxy URL (set BIBLE_PROXY_URL); their pages will show a "not configured" notice`,
    );
  }
  await writeText(MANIFEST_SCRIPT_PATH, manifestScript(manifest));

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const translationCount = builds.reduce((n, b) => n + b.translations.length, 0);
  log(`Done: ${formatNumber(pageCount, 'en')} pages across ${translationCount} translations in ${builds.length} languages in ${seconds}s`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
