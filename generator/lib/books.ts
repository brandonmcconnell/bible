/**
 * Canon tables keyed by USFM/Paratext book identifiers (the IDs used by the
 * Free Use Bible API). URL slugs are deliberately language-neutral so that the
 * same chapter has the same path in every translation and language, which is
 * what makes the client-side translation switcher trivial.
 */

export type Section = 'ot' | 'nt' | 'extra';

interface BookMeta {
  slug: string;
  englishName: string;
}

const OLD_TESTAMENT: ReadonlyArray<readonly [string, string, string]> = [
  ['GEN', 'genesis', 'Genesis'],
  ['EXO', 'exodus', 'Exodus'],
  ['LEV', 'leviticus', 'Leviticus'],
  ['NUM', 'numbers', 'Numbers'],
  ['DEU', 'deuteronomy', 'Deuteronomy'],
  ['JOS', 'joshua', 'Joshua'],
  ['JDG', 'judges', 'Judges'],
  ['RUT', 'ruth', 'Ruth'],
  ['1SA', '1-samuel', '1 Samuel'],
  ['2SA', '2-samuel', '2 Samuel'],
  ['1KI', '1-kings', '1 Kings'],
  ['2KI', '2-kings', '2 Kings'],
  ['1CH', '1-chronicles', '1 Chronicles'],
  ['2CH', '2-chronicles', '2 Chronicles'],
  ['EZR', 'ezra', 'Ezra'],
  ['NEH', 'nehemiah', 'Nehemiah'],
  ['EST', 'esther', 'Esther'],
  ['JOB', 'job', 'Job'],
  ['PSA', 'psalms', 'Psalms'],
  ['PRO', 'proverbs', 'Proverbs'],
  ['ECC', 'ecclesiastes', 'Ecclesiastes'],
  ['SNG', 'song-of-solomon', 'Song of Solomon'],
  ['ISA', 'isaiah', 'Isaiah'],
  ['JER', 'jeremiah', 'Jeremiah'],
  ['LAM', 'lamentations', 'Lamentations'],
  ['EZK', 'ezekiel', 'Ezekiel'],
  ['DAN', 'daniel', 'Daniel'],
  ['HOS', 'hosea', 'Hosea'],
  ['JOL', 'joel', 'Joel'],
  ['AMO', 'amos', 'Amos'],
  ['OBA', 'obadiah', 'Obadiah'],
  ['JON', 'jonah', 'Jonah'],
  ['MIC', 'micah', 'Micah'],
  ['NAM', 'nahum', 'Nahum'],
  ['HAB', 'habakkuk', 'Habakkuk'],
  ['ZEP', 'zephaniah', 'Zephaniah'],
  ['HAG', 'haggai', 'Haggai'],
  ['ZEC', 'zechariah', 'Zechariah'],
  ['MAL', 'malachi', 'Malachi'],
];

const NEW_TESTAMENT: ReadonlyArray<readonly [string, string, string]> = [
  ['MAT', 'matthew', 'Matthew'],
  ['MRK', 'mark', 'Mark'],
  ['LUK', 'luke', 'Luke'],
  ['JHN', 'john', 'John'],
  ['ACT', 'acts', 'Acts'],
  ['ROM', 'romans', 'Romans'],
  ['1CO', '1-corinthians', '1 Corinthians'],
  ['2CO', '2-corinthians', '2 Corinthians'],
  ['GAL', 'galatians', 'Galatians'],
  ['EPH', 'ephesians', 'Ephesians'],
  ['PHP', 'philippians', 'Philippians'],
  ['COL', 'colossians', 'Colossians'],
  ['1TH', '1-thessalonians', '1 Thessalonians'],
  ['2TH', '2-thessalonians', '2 Thessalonians'],
  ['1TI', '1-timothy', '1 Timothy'],
  ['2TI', '2-timothy', '2 Timothy'],
  ['TIT', 'titus', 'Titus'],
  ['PHM', 'philemon', 'Philemon'],
  ['HEB', 'hebrews', 'Hebrews'],
  ['JAS', 'james', 'James'],
  ['1PE', '1-peter', '1 Peter'],
  ['2PE', '2-peter', '2 Peter'],
  ['1JN', '1-john', '1 John'],
  ['2JN', '2-john', '2 John'],
  ['3JN', '3-john', '3 John'],
  ['JUD', 'jude', 'Jude'],
  ['REV', 'revelation', 'Revelation'],
];

/** Deuterocanonical / apocryphal books, in the traditional Apocrypha order. */
const EXTRA_BOOKS: ReadonlyArray<readonly [string, string, string]> = [
  ['TOB', 'tobit', 'Tobit'],
  ['JDT', 'judith', 'Judith'],
  ['ESG', 'esther-greek', 'Esther (Greek)'],
  ['WIS', 'wisdom-of-solomon', 'Wisdom of Solomon'],
  ['SIR', 'sirach', 'Sirach'],
  ['BAR', 'baruch', 'Baruch'],
  ['LJE', 'letter-of-jeremiah', 'Letter of Jeremiah'],
  ['S3Y', 'song-of-the-three', 'Song of the Three Young Men'],
  ['SUS', 'susanna', 'Susanna'],
  ['BEL', 'bel-and-the-dragon', 'Bel and the Dragon'],
  ['1MA', '1-maccabees', '1 Maccabees'],
  ['2MA', '2-maccabees', '2 Maccabees'],
  ['3MA', '3-maccabees', '3 Maccabees'],
  ['4MA', '4-maccabees', '4 Maccabees'],
  ['1ES', '1-esdras', '1 Esdras'],
  ['2ES', '2-esdras', '2 Esdras'],
  ['MAN', 'prayer-of-manasseh', 'Prayer of Manasseh'],
  ['PS2', 'psalm-151', 'Psalm 151'],
  ['ODA', 'odes', 'Odes'],
  ['PSS', 'psalms-of-solomon', 'Psalms of Solomon'],
  ['DAG', 'daniel-greek', 'Daniel (Greek)'],
  ['LAO', 'laodiceans', 'Laodiceans'],
  ['EZA', 'ezra-apocalypse', 'Ezra Apocalypse'],
  ['5EZ', '5-ezra', '5 Ezra'],
  ['6EZ', '6-ezra', '6 Ezra'],
  ['JUB', 'jubilees', 'Jubilees'],
  ['ENO', 'enoch', 'Enoch'],
  ['1MQ', '1-meqabyan', '1 Meqabyan'],
  ['2MQ', '2-meqabyan', '2 Meqabyan'],
  ['3MQ', '3-meqabyan', '3 Meqabyan'],
  ['REP', 'reproof', 'Reproof'],
  ['4BA', '4-baruch', '4 Baruch'],
  ['LBA', 'letter-of-baruch', 'Letter of Baruch'],
];

const META = new Map<string, BookMeta & { section: Section; order: number }>();
[...OLD_TESTAMENT, ...NEW_TESTAMENT, ...EXTRA_BOOKS].forEach(([id, slug, englishName], index) => {
  const section: Section = index < OLD_TESTAMENT.length ? 'ot' : index < OLD_TESTAMENT.length + NEW_TESTAMENT.length ? 'nt' : 'extra';
  META.set(id, { slug, englishName, section, order: index });
});

export const OLD_TESTAMENT_IDS: readonly string[] = OLD_TESTAMENT.map(([id]) => id);
export const NEW_TESTAMENT_IDS: readonly string[] = NEW_TESTAMENT.map(([id]) => id);
export const EXTRA_BOOK_IDS: readonly string[] = EXTRA_BOOKS.map(([id]) => id);

/**
 * The Roman Catholic Old Testament order, with the deuterocanonical books
 * interleaved. Greek Esther and Greek Daniel (when a translation ships them as
 * separate books) sit directly after their Hebrew counterparts.
 */
export const CATHOLIC_OLD_TESTAMENT_ORDER: readonly string[] = [
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH',
  'TOB', 'JDT', 'EST', 'ESG', '1MA', '2MA', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'WIS', 'SIR', 'ISA', 'JER', 'LAM',
  'BAR', 'LJE', 'EZK', 'DAN', 'DAG', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
];

export function sectionOf(bookId: string): Section {
  return META.get(bookId)?.section ?? 'extra';
}

/** Canonical sort key so books render in a predictable order regardless of the API's `order` field. */
export function canonicalOrder(bookId: string): number {
  return META.get(bookId)?.order ?? 1000;
}

export function bookSlug(bookId: string): string {
  return META.get(bookId)?.slug ?? bookId.toLowerCase();
}

export function englishBookName(bookId: string): string {
  return META.get(bookId)?.englishName ?? bookId;
}

export function allKnownBookIds(): string[] {
  return [...META.keys()];
}

/** English fallback names for every known book, used by the client-side manifest. */
export function englishBookNames(): Record<string, string> {
  const names: Record<string, string> = {};
  for (const [id, meta] of META) names[id] = meta.englishName;
  return names;
}
