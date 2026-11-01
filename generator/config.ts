/**
 * Site configuration: which languages, translations and commentaries to
 * publish, and where the generated output goes. Everything else is derived
 * from the Free Use Bible API.
 *
 * Translations are discovered automatically: every translation whose ISO 639-3
 * language code maps to a Mintlify language code (see `LANGUAGES`) is
 * included. `curated` entries override slug/label/name/canon for well-known
 * translations and choose the default for a language; everything else gets
 * sensible derived values.
 *
 * Mintlify only accepts the language codes listed in `LANGUAGES`, so
 * translations in other languages (Sanskrit, Koine Greek, Latin, and ~1,000
 * minority languages) cannot be represented as Mintlify languages and are
 * skipped. The build prints how many were skipped.
 */
import type { MintlifyLanguage } from './lib/i18n.ts';

export type Canon = 'protestant' | 'catholic';

export interface TranslationOverrides {
  /** URL segment for this translation, e.g. `kjv` → `/en/kjv/genesis/1`. Derived from the API's short name when omitted. */
  slug?: string;
  /** Short label shown in the version switcher, e.g. `KJV`. */
  label?: string;
  /** Display name (defaults to the API's `name`). */
  name?: string;
  /**
   * How to arrange books that fall outside the 66-book Protestant canon.
   * - `protestant`: extra books go into a separate Apocrypha/Deuterocanon group.
   * - `catholic`: deuterocanonical books are interleaved into the Old Testament in Catholic order.
   * Detected automatically when omitted.
   */
  canon?: Canon;
  /** Label to use for the extra-books group when `canon` is `protestant`. */
  extraBooksLabel?: 'apocrypha' | 'deuterocanon';
  /** Marks the default translation for its language. */
  default?: boolean;
  /** Badge shown next to the version in the switcher. Derived (Apocrypha / Catholic / NT / Portions) when omitted. */
  tag?: string;
  /** Force a different Mintlify language than the one derived from the ISO code (e.g. Traditional Chinese). */
  language?: MintlifyLanguage;
  /** Exclude this translation from the build. */
  exclude?: boolean;
}

/** Where the text of a licensed translation comes from at request time (see proxy/). */
export type LiveProvider = 'esv' | 'nlt' | 'api-bible';

/**
 * A translation whose text may not be stored or republished (ESV, NLT, NKJV,
 * NASB, CSB, …). Pages are generated with full navigation but without text;
 * the reader script fetches each chapter from the proxy when it is viewed.
 */
export interface LicensedTranslation {
  /** URL segment, e.g. `esv` → `/en/esv/genesis/1`. */
  slug: string;
  /** Short label for the version switcher. */
  label: string;
  name: string;
  provider: LiveProvider;
  /**
   * Provider-specific edition id: `esv` for ESV; `NLT`/`NLTUK`/`NTV` for the
   * NLT API; an API.Bible bible id or abbreviation (e.g. `NKJV`) for API.Bible.
   */
  edition: string;
  /** Copyright notice the license requires on every page that shows the text. */
  copyright: string;
  /** Publisher link the license requires. */
  website: string;
  /**
   * API translation id whose book/chapter structure is used for navigation.
   * Defaults to the KJV (66 books). Use a translation with the same canon.
   */
  structureFrom?: string;
}

export interface LanguageDefinition {
  /** Mintlify language code; also the first URL segment. */
  code: MintlifyLanguage;
  /** Human readable language name in its own language. */
  name: string;
  /** BCP 47 tag written to the `lang` attribute of scripture containers. */
  htmlLang: string;
  /** ISO 639-3 codes used by the API that belong to this language. */
  iso: string[];
  /** Include the Theographic study section (its data is English). */
  study?: boolean;
  /** Include commentaries from the API whose language matches (`'all'` or a list of ids). */
  commentaries?: 'all' | string[];
  /** Licensed translations served live through the proxy. */
  licensed?: LicensedTranslation[];
}

export interface SiteConfig {
  /** Every Mintlify language the site can publish. Languages without any translation are skipped. */
  languages: LanguageDefinition[];
  /** Per-translation overrides keyed by API translation id. */
  curated: Record<string, TranslationOverrides>;
  /** Skip translations with fewer books than this (0 keeps everything, including single-book portions). */
  minBooks: number;
  /** Generate `/data/xref/<BOOK>/<chapter>.json` cross-reference files. */
  crossReferences: boolean;
  /** Maximum concurrent API requests. */
  concurrency: number;
  /** Directory for cached API responses (git-ignored). */
  cacheDir: string;
  /** Where generated navigation JSON files are written. */
  navigationDir: string;
  /** Where generated data files (cross references) are written. */
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
  /**
   * Base URL of the deployed `proxy/` worker that serves licensed translations,
   * e.g. `https://bible-proxy.example.workers.dev`. Overridden by the
   * `BIBLE_PROXY_URL` environment variable at build time. When empty, licensed
   * chapter pages show a "not configured" notice instead of text.
   */
  liveProxyUrl: string;
}

export const LANGUAGES: LanguageDefinition[] = [
  {
    code: 'en',
    name: 'English',
    htmlLang: 'en',
    iso: ['eng'],
    study: true,
    commentaries: 'all',
    licensed: [
      {
        slug: 'esv',
        label: 'ESV',
        name: 'English Standard Version',
        provider: 'esv',
        edition: 'esv',
        copyright:
          'Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved. The ESV text may not be quoted in any publication made available to the public by a Creative Commons license. The ESV may not be translated into any other language.',
        website: 'https://www.esv.org/',
      },
      {
        slug: 'nlt',
        label: 'NLT',
        name: 'New Living Translation',
        provider: 'nlt',
        edition: 'NLT',
        copyright:
          'Scripture quotations marked (NLT) are taken from the Holy Bible, New Living Translation, copyright © 1996, 2004, 2015 by Tyndale House Foundation. Used by permission of Tyndale House Publishers, Carol Stream, Illinois 60188. All rights reserved.',
        website: 'https://www.tyndale.com/nlt/',
      },
      {
        slug: 'nkjv',
        label: 'NKJV',
        name: 'New King James Version',
        provider: 'api-bible',
        edition: 'NKJV',
        copyright: 'Scripture taken from the New King James Version®. Copyright © 1982 by Thomas Nelson. Used by permission. All rights reserved.',
        website: 'https://www.thomasnelsonbibles.com/nkjv-bible/',
      },
      {
        slug: 'nasb',
        label: 'NASB',
        name: 'New American Standard Bible (2020)',
        provider: 'api-bible',
        edition: 'NASB2020',
        copyright:
          'Scripture quotations taken from the (NASB®) New American Standard Bible®, Copyright © 1960, 1971, 1977, 1995, 2020 by The Lockman Foundation. Used by permission. All rights reserved. lockman.org',
        website: 'https://www.lockman.org/',
      },
      {
        slug: 'csb',
        label: 'CSB',
        name: 'Christian Standard Bible',
        provider: 'api-bible',
        edition: 'CSB',
        copyright:
          'Scripture quotations marked CSB have been taken from the Christian Standard Bible®, Copyright © 2017 by Holman Bible Publishers. Used by permission. Christian Standard Bible® and CSB® are federally registered trademarks of Holman Bible Publishers.',
        website: 'https://csbible.com/',
      },
      {
        slug: 'amp',
        label: 'AMP',
        name: 'Amplified Bible',
        provider: 'api-bible',
        edition: 'AMP',
        copyright:
          'Scripture quotations taken from the Amplified® Bible (AMP), Copyright © 2015 by The Lockman Foundation. Used by permission. lockman.org',
        website: 'https://www.lockman.org/',
      },
      {
        slug: 'msg',
        label: 'MSG',
        name: 'The Message',
        provider: 'api-bible',
        edition: 'MSG',
        copyright:
          'Scripture quotations marked MSG are taken from THE MESSAGE, copyright © 1993, 2002, 2018 by Eugene H. Peterson. Used by permission of NavPress. All rights reserved. Represented by Tyndale House Publishers.',
        website: 'https://messagebible.com/',
      },
    ],
  },
  { code: 'es', name: 'Español', htmlLang: 'es', iso: ['spa'] },
  { code: 'fr', name: 'Français', htmlLang: 'fr', iso: ['fra'] },
  { code: 'de', name: 'Deutsch', htmlLang: 'de', iso: ['deu'] },
  { code: 'pt-BR', name: 'Português', htmlLang: 'pt-BR', iso: ['por'] },
  { code: 'it', name: 'Italiano', htmlLang: 'it', iso: ['ita'] },
  { code: 'nl', name: 'Nederlands', htmlLang: 'nl', iso: ['nld'] },
  { code: 'ru', name: 'Русский', htmlLang: 'ru', iso: ['rus'] },
  { code: 'uk', name: 'Українська', htmlLang: 'uk', iso: ['ukr'] },
  { code: 'pl', name: 'Polski', htmlLang: 'pl', iso: ['pol'] },
  { code: 'cs', name: 'Čeština', htmlLang: 'cs', iso: ['ces'] },
  { code: 'ro', name: 'Română', htmlLang: 'ro', iso: ['ron'] },
  { code: 'hu', name: 'Magyar', htmlLang: 'hu', iso: ['hun'] },
  { code: 'sv', name: 'Svenska', htmlLang: 'sv', iso: ['swe'] },
  { code: 'da', name: 'Dansk', htmlLang: 'da', iso: ['dan'] },
  { code: 'no', name: 'Norsk', htmlLang: 'nb', iso: ['nob', 'nno', 'nor'] },
  { code: 'tr', name: 'Türkçe', htmlLang: 'tr', iso: ['tur'] },
  { code: 'ar', name: 'العربية', htmlLang: 'ar', iso: ['arb', 'ara'] },
  { code: 'he', name: 'עברית', htmlLang: 'he', iso: ['heb', 'hbo'] },
  { code: 'hi', name: 'हिन्दी', htmlLang: 'hi', iso: ['hin'] },
  { code: 'id', name: 'Bahasa Indonesia', htmlLang: 'id', iso: ['ind'] },
  { code: 'vi', name: 'Tiếng Việt', htmlLang: 'vi', iso: ['vie'] },
  { code: 'ja', name: '日本語', htmlLang: 'ja', iso: ['jpn'] },
  { code: 'ko', name: '한국어', htmlLang: 'ko', iso: ['kor'] },
  { code: 'zh-Hans', name: '简体中文', htmlLang: 'zh-Hans', iso: ['cmn', 'zho'] },
  { code: 'zh-Hant', name: '繁體中文', htmlLang: 'zh-Hant', iso: ['yue'] },
  { code: 'ca', name: 'Català', htmlLang: 'ca', iso: ['cat'] },
  { code: 'lv', name: 'Latviešu', htmlLang: 'lv', iso: ['lav'] },
  { code: 'uz', name: 'Oʻzbekcha', htmlLang: 'uz', iso: ['uzb', 'uzn', 'uzs'] },
];

export const siteConfig: SiteConfig = {
  languages: LANGUAGES,
  minBooks: 0,
  crossReferences: true,
  concurrency: 12,
  cacheDir: '.cache/helloao',
  navigationDir: 'navigation',
  dataDir: 'data',
  datasets: { crossReferences: 'open-cross-ref', entities: 'theographic' },
  repositoryUrl: 'https://github.com/brandonmcconnell/bible',
  cdnBaseUrl: 'https://cdn.jsdelivr.net/gh/brandonmcconnell/bible@main',
  liveProxyUrl: process.env['BIBLE_PROXY_URL'] ?? '',
  curated: {
    // English
    eng_kjv: { slug: 'kjv', label: 'KJV', name: 'King James Version', default: true },
    eng_kja: { slug: 'kjva', label: 'KJVA', name: 'King James Version with Apocrypha', extraBooksLabel: 'apocrypha' },
    eng_cpb: { slug: 'kjv-cambridge', label: 'KJV Cambridge', name: 'KJV Cambridge Paragraph Bible' },
    ENGWEBP: { slug: 'web', label: 'WEB', name: 'World English Bible' },
    eng_web: { slug: 'web-classic', label: 'WEB Classic', name: 'World English Bible Classic', extraBooksLabel: 'deuterocanon' },
    eng_webc: { slug: 'web-catholic', label: 'WEB Catholic', name: 'World English Bible (Catholic)', canon: 'catholic' },
    eng_webpb: { slug: 'webbe', label: 'WEBBE', name: 'World English Bible British Edition' },
    eng_weu: { slug: 'webbe-deuterocanon', label: 'WEBBE + Deuterocanon', name: 'World English Bible British Edition with Deuterocanon', extraBooksLabel: 'deuterocanon' },
    eng_webu: { slug: 'web-updated', label: 'WEBU', name: 'World English Bible Updated', extraBooksLabel: 'deuterocanon' },
    eng_wmb: { slug: 'wmb', label: 'WMB', name: 'World Messianic Bible' },
    eng_wmu: { slug: 'wmbbe', label: 'WMBBE', name: 'World Messianic Bible British Edition' },
    eng_asv: { slug: 'asv', label: 'ASV', name: 'American Standard Version' },
    eng_abt: { slug: 'asv-byzantine', label: 'ASV Byzantine', name: 'American Standard Version Byzantine Text' },
    BSB: { slug: 'bsb', label: 'BSB', name: 'Berean Standard Bible' },
    eng_msb: { slug: 'msb', label: 'MSB', name: 'Majority Standard Bible' },
    eng_dra: { slug: 'dra', label: 'DRA', name: 'Douay-Rheims 1899', canon: 'catholic' },
    eng_ylt: { slug: 'ylt', label: 'YLT', name: "Young's Literal Translation" },
    eng_dby: { slug: 'darby', label: 'Darby', name: 'Darby Translation' },
    eng_gnv: { slug: 'geneva', label: 'Geneva 1599', name: 'Geneva Bible 1599' },
    eng_bbe: { slug: 'bbe', label: 'BBE', name: 'Bible in Basic English' },
    eng_lsv: { slug: 'lsv', label: 'LSV', name: 'Literal Standard Version' },
    eng_fbv: { slug: 'fbv', label: 'FBV', name: 'Free Bible Version' },
    eng_net: { slug: 'net', label: 'NET', name: 'NET Bible' },
    eng_ulb: { slug: 'ulb', label: 'ULB', name: 'Unlocked Literal Bible' },
    eng_wbs: { slug: 'webster', label: 'Webster', name: 'Noah Webster Bible' },
    eng_t4t: { slug: 't4t', label: 'T4T', name: 'Translation for Translators' },
    eng_rv5: { slug: 'rv1895', label: 'RV 1895', name: 'Revised Version with Apocrypha (1895)', extraBooksLabel: 'apocrypha' },
    eng_jps: { slug: 'jps1917', label: 'JPS 1917', name: 'JPS Tanakh 1917' },
    eng_lee: { slug: 'leeser', label: 'Leeser', name: 'Isaac Leeser Tanakh' },
    eng_ojb: { slug: 'ojb', label: 'OJB', name: 'The Orthodox Jewish Bible' },
    eng_bre: { slug: 'brenton', label: 'Brenton LXX', name: 'Brenton Septuagint Translation', extraBooksLabel: 'deuterocanon', tag: 'Septuagint' },
    eng_boy: { slug: 'brenton-updated', label: 'Updated Brenton', name: 'Updated Brenton English Septuagint', extraBooksLabel: 'deuterocanon', tag: 'Septuagint' },
    eng_lxx: { slug: 'lxx2012', label: 'LXX2012', name: 'LXX2012: Septuagint in American English', extraBooksLabel: 'deuterocanon', tag: 'Septuagint' },
    eng_lxu: { slug: 'lxx2012-uk', label: 'LXX2012 (UK)', name: 'LXX2012: Septuagint in British/International English', extraBooksLabel: 'deuterocanon', tag: 'Septuagint' },
    eng_wyc2017: { slug: 'wycliffe', label: 'Wycliffe', name: "Wycliffe's Bible with Modern Spelling", canon: 'catholic' },
    eng_wyc2018: { slug: 'wycliffe-enhanced', label: 'Wycliffe (Enhanced)', name: "Wycliffe's Bible with Modern Spelling (Enhanced)", canon: 'catholic' },
    eng_w88: { slug: 'wycliffe-1388', label: 'Wycliffe 1388', name: 'Wycliffe Bible (portions)' },
    eng_tnt: { slug: 'tyndale', label: 'Tyndale NT', name: 'Tyndale New Testament' },
    eng_emtv: { slug: 'emtv', label: 'EMTV', name: 'English Majority Text Version' },
    eng_tce: { slug: 'tcent', label: 'TCENT', name: 'Text-Critical English New Testament' },
    eng_f35: { slug: 'tntc', label: 'TNTC', name: 'The New Testament with Commentary' },
    eng_noy: { slug: 'noyes', label: 'Noyes', name: 'George Noyes Bible' },
    eng_pev: { slug: 'pev', label: 'PEV', name: 'Plain English Version' },
    eng_glw: { slug: 'glw', label: 'GLW', name: "God's Living Word" },
    eng_our: { slug: 'ourb', label: 'OURB', name: 'One Unity Resource Bible' },
    eng_oke: { slug: 'targum-onkelos', label: 'Targum Onkelos', name: 'Targum Onkelos (Etheridge)' },
    eng_aoi: { slug: 'anindilyakwa-english', label: 'AEB', name: 'Anindilyakwa English Bible' },
    eng_nna: { slug: 'nyangumarta-english', label: 'NEB', name: 'Nyangumarta English Bible' },
    eng_bar: { slug: 'barkly', label: 'BBP', name: 'Barkly Bible Portions' },
    AAB: { slug: 'aab', label: 'AAB', name: 'Accessible Ancients Bible' },
    GHT: { slug: 'ght', label: 'GHT', name: "Garth's Hyper-literal Translation" },
    // Spanish
    spa_r09: { slug: 'rvr1909', label: 'RVR 1909', name: 'Reina Valera 1909', default: true },
    spa_rvg: { slug: 'rvg', label: 'RVG', name: 'Reina Valera Gómez' },
    spa_v2p: { slug: 'valera1602p', label: 'Valera 1602 P', name: 'Valera 1602 Purificada' },
    spa_bes: { slug: 'bes', label: 'BES', name: 'La Biblia en Español Sencillo' },
    spa_blm: { slug: 'blm', label: 'BLM', name: 'Santa Biblia libre para el mundo' },
    spa_pdt: { slug: 'pdt', label: 'PDT', name: 'Palabra de Dios para ti' },
    spa_vbl: { slug: 'vbl', label: 'VBL', name: 'Versión Biblia Libre' },
    spa_onbv: { slug: 'nbv', label: 'NBV', name: 'Nueva Biblia Viva' },
    // French
    fra_lsg: { slug: 'lsg', label: 'LSG', name: 'Louis Segond 1910', default: true },
    fra_jnd: { slug: 'darby', label: 'Darby', name: 'Bible J.N. Darby' },
    fra_ost: { slug: 'ostervald', label: 'Ostervald', name: 'Bible Ostervald' },
    fra_ncl: { slug: 'crampon', label: 'Crampon', name: 'Sainte Bible néo-Crampon Libre', canon: 'catholic' },
    // German
    deu_l12: { slug: 'luther1912', label: 'Luther 1912', name: 'Lutherbibel 1912', default: true },
    deu_sch: { slug: 'schlachter1951', label: 'Schlachter 1951', name: 'Schlachter-Bibel 1951' },
    deu_elo: { slug: 'elberfelder1905', label: 'Elberfelder 1905', name: 'Unrevidierte Elberfelder' },
    deu_elbbk: { slug: 'elberfelder-bk', label: 'Elberfelder BK', name: 'Elberfelder Übersetzung (bibelkommentare.de)' },
    deu_tkw: { slug: 'textbibel', label: 'Textbibel', name: 'Textbibel von Kautzsch und Weizsäcker' },
    // Portuguese
    por_blj: { slug: 'blivre', label: 'Bíblia Livre', name: 'Bíblia Livre', default: true },
    por_bsl: { slug: 'bpm', label: 'BPM', name: 'Bíblia Portuguesa Mundial' },
    por_onbv: { slug: 'nbv', label: 'NBV', name: 'Nova Bíblia Viva' },
    por_blt: { slug: 'blt', label: 'BLT', name: 'Bíblia Livre Para Todos' },
    por_tft: { slug: 'tpt', label: 'TpT', name: 'Tradução para Tradutores' },
    // Italian
    ita_riv: { slug: 'riveduta1927', label: 'Riveduta 1927', name: 'Riveduta 1927', default: true },
    ita_dio: { slug: 'diodati1885', label: 'Diodati 1885', name: 'Diodati 1885' },
    // Dutch
    nld_nbg: { slug: 'nbg1951', label: 'NBG 1951', name: 'NBG-vertaling 1951', default: true },
    nld_: { slug: 'sv1917', label: '1917', name: 'De Heilige Schrift 1917' },
    nld_1939: { slug: 'canisius1939', label: 'Canisius 1939', name: 'Petrus Canisiusvertaling 1939', canon: 'catholic' },
    nld_gbv: { slug: 'gods-boek', label: 'Gods Boek', name: 'Gods Boek' },
    // Russian, Ukrainian, Polish, Czech, Romanian
    rus_syn: { slug: 'synodal', label: 'Синодальный', name: 'Синодальный перевод', default: true },
    ukr_1996: { slug: 'bju1996', label: 'BJU 1996', name: 'Біблія (BJU 1996)', default: true },
    ukr_pan: { slug: 'kulish', label: 'Куліш', name: 'Біблія в перекладі П. Куліша та І. Пулюя (1905)' },
    ukr_ufb: { slug: 'ufb', label: 'UFB', name: 'Біблія свободи' },
    ukr_npu: { slug: 'npu', label: 'НПУ', name: 'Новий Переклад Українською' },
    pol_ubg: { slug: 'ubg', label: 'UBG', name: 'Uwspółcześniona Biblia Gdańska', default: true },
    pol_bib: { slug: 'sz', label: 'SŻ', name: 'Słowo Życia' },
    ces_bkr: { slug: 'kralicka1613', label: 'Kralická 1613', name: 'Bible Kralická 1613', default: true },
    ces_nkb: { slug: 'nkb', label: 'NKB', name: 'Nová Bible Kralická' },
    ces_bib: { slug: 'snc', label: 'SNC', name: 'Slovo na cestu' },
    ron_btf: { slug: 'btf', label: 'BTF', name: 'Biblia Traducerea Fidelă', default: true },
    ron_924: { slug: 'cornilescu1924', label: 'Cornilescu 1924', name: 'Biblia Dumitru Cornilescu 1924 (chirilică)' },
    ron_lsb: { slug: 'lsb', label: 'LSB', name: 'Liber Sfânta Biblie' },
    ron_bayash: { slug: 'bayash', label: 'Bayash', name: 'Sfânta Biblie (Bayash)' },
    ron_lud: { slug: 'ludari', label: 'Ludari', name: 'Luka (Ludari)' },
    // Other European
    hun_bib: { slug: 'nyitott', label: 'Nyitott ÚSZ', name: 'Nyitott Újszövetség', default: true },
    swe_fol: { slug: 'folkbibeln', label: 'Folkbibeln', name: 'Svenska Folkbibeln', default: true },
    swe_svk: { slug: 'karnbibeln', label: 'Kärnbibeln', name: 'Svenska Kärnbibeln' },
    dan_det: { slug: 'bibelen1931', label: '1931', name: 'Bibelen 1931', default: true },
    nob_lbb: { slug: 'lbb', label: 'LBB', name: 'Levende Bibelen (NT)', default: true },
    tur_ytc: { slug: 'ytc', label: 'YTC', name: 'Yorumsuz Türkçe Çeviri', default: true },
    tur_obt: { slug: 'obt', label: 'OBT', name: 'Open Basic Turkish New Testament' },
    // Semitic
    arb_vdv: { slug: 'vandyck', label: 'فان دايك', name: 'الكتاب المقدس – ترجمة فان دايك', default: true },
    ARBNAV: { slug: 'nav', label: 'كتاب الحياة', name: 'كتاب الحياة (NAV)' },
    heb_mod: { slug: 'modern', label: 'עברית מודרנית', name: 'תנ״ך עברי מודרני', default: true },
    heb_wlc: { slug: 'wlc', label: 'WLC', name: 'Westminster Leningrad Codex' },
    hbo_wlc: { slug: 'wlc-hbo', label: 'WLC (hbo)', name: 'Westminster Leningrad Codex (Biblical Hebrew)' },
    HBOMAS: { slug: 'masoretic', label: 'MAS', name: 'Masoretic Text' },
    heb_lbm: { slug: 'haderekh', label: 'הדרך', name: 'הברית החדשה / הדרך' },
    heb_scg: { slug: 'salkinson', label: 'סלקינסון', name: 'הברית החדשה של סלקינסון' },
    // South & Southeast Asia
    HINIRV: { slug: 'irv', label: 'IRV', name: 'इंडियन रिवाइज्ड वर्जन', default: true },
    hin_cvb: { slug: 'cvb', label: 'CVB', name: 'हिंदी समकालीन संस्करण' },
    ind_ayt: { slug: 'ayt', label: 'AYT', name: 'Alkitab Yang Terbuka', default: true },
    ind_obo: { slug: 'tsi', label: 'TSI', name: 'Terjemahan Sederhana Indonesia' },
    ind_ags: { slug: 'ags', label: 'AGS', name: 'Alkitab Gratis untuk Semua' },
    vie_1934: { slug: 'vie1934', label: '1934', name: 'Kinh Thánh 1934', default: true },
    vie_vcb: { slug: 'vcb', label: 'VCB', name: 'Kinh Thánh Hiện Đại' },
    // East Asia
    jpn_loc: { slug: 'shinkaiyaku1965', label: '新改訳 1965', name: '新改訳新約聖書 (1965)', default: true },
    kor_old: { slug: 'krv1910', label: '개역 (1910)', name: '한국어 성경 (1910)', default: true },
    cmn_cu1: { slug: 'cuvs', label: '和合本', name: '新标点和合本', default: true },
    cmn_cbs: { slug: 'ccbs', label: '当代译本', name: '圣经当代译本' },
    cmn_feb: { slug: 'feb', label: '易读圣经', name: '免费的易读圣经' },
    cmn_cuv: { slug: 'cuvt', label: '和合本', name: '新標點和合本', language: 'zh-Hant', default: true },
    cmn_cbt: { slug: 'ccbt', label: '當代譯本', name: '聖經當代譯本', language: 'zh-Hant' },
  },
};
