/**
 * USFM book ids (the ids the site uses) mapped to the names each provider
 * expects in references. Protestant canon only: that is all the licensed
 * providers offer.
 */

interface BookNames {
  /** Name accepted by the ESV and NLT passage query parsers. */
  name: string;
  /** Abbreviation used by the NLT API (`ref=John.1`). */
  nlt: string;
}

const BOOKS: Record<string, BookNames> = {
  GEN: { name: 'Genesis', nlt: 'Gen' },
  EXO: { name: 'Exodus', nlt: 'Exod' },
  LEV: { name: 'Leviticus', nlt: 'Lev' },
  NUM: { name: 'Numbers', nlt: 'Num' },
  DEU: { name: 'Deuteronomy', nlt: 'Deut' },
  JOS: { name: 'Joshua', nlt: 'Josh' },
  JDG: { name: 'Judges', nlt: 'Judg' },
  RUT: { name: 'Ruth', nlt: 'Ruth' },
  '1SA': { name: '1 Samuel', nlt: '1Sam' },
  '2SA': { name: '2 Samuel', nlt: '2Sam' },
  '1KI': { name: '1 Kings', nlt: '1Kgs' },
  '2KI': { name: '2 Kings', nlt: '2Kgs' },
  '1CH': { name: '1 Chronicles', nlt: '1Chr' },
  '2CH': { name: '2 Chronicles', nlt: '2Chr' },
  EZR: { name: 'Ezra', nlt: 'Ezra' },
  NEH: { name: 'Nehemiah', nlt: 'Neh' },
  EST: { name: 'Esther', nlt: 'Esth' },
  JOB: { name: 'Job', nlt: 'Job' },
  PSA: { name: 'Psalm', nlt: 'Ps' },
  PRO: { name: 'Proverbs', nlt: 'Prov' },
  ECC: { name: 'Ecclesiastes', nlt: 'Eccl' },
  SNG: { name: 'Song of Solomon', nlt: 'Song' },
  ISA: { name: 'Isaiah', nlt: 'Isa' },
  JER: { name: 'Jeremiah', nlt: 'Jer' },
  LAM: { name: 'Lamentations', nlt: 'Lam' },
  EZK: { name: 'Ezekiel', nlt: 'Ezek' },
  DAN: { name: 'Daniel', nlt: 'Dan' },
  HOS: { name: 'Hosea', nlt: 'Hos' },
  JOL: { name: 'Joel', nlt: 'Joel' },
  AMO: { name: 'Amos', nlt: 'Amos' },
  OBA: { name: 'Obadiah', nlt: 'Obad' },
  JON: { name: 'Jonah', nlt: 'Jonah' },
  MIC: { name: 'Micah', nlt: 'Mic' },
  NAM: { name: 'Nahum', nlt: 'Nah' },
  HAB: { name: 'Habakkuk', nlt: 'Hab' },
  ZEP: { name: 'Zephaniah', nlt: 'Zeph' },
  HAG: { name: 'Haggai', nlt: 'Hag' },
  ZEC: { name: 'Zechariah', nlt: 'Zech' },
  MAL: { name: 'Malachi', nlt: 'Mal' },
  MAT: { name: 'Matthew', nlt: 'Matt' },
  MRK: { name: 'Mark', nlt: 'Mark' },
  LUK: { name: 'Luke', nlt: 'Luke' },
  JHN: { name: 'John', nlt: 'John' },
  ACT: { name: 'Acts', nlt: 'Acts' },
  ROM: { name: 'Romans', nlt: 'Rom' },
  '1CO': { name: '1 Corinthians', nlt: '1Cor' },
  '2CO': { name: '2 Corinthians', nlt: '2Cor' },
  GAL: { name: 'Galatians', nlt: 'Gal' },
  EPH: { name: 'Ephesians', nlt: 'Eph' },
  PHP: { name: 'Philippians', nlt: 'Phil' },
  COL: { name: 'Colossians', nlt: 'Col' },
  '1TH': { name: '1 Thessalonians', nlt: '1Thes' },
  '2TH': { name: '2 Thessalonians', nlt: '2Thes' },
  '1TI': { name: '1 Timothy', nlt: '1Tim' },
  '2TI': { name: '2 Timothy', nlt: '2Tim' },
  TIT: { name: 'Titus', nlt: 'Titus' },
  PHM: { name: 'Philemon', nlt: 'Phlm' },
  HEB: { name: 'Hebrews', nlt: 'Heb' },
  JAS: { name: 'James', nlt: 'Jas' },
  '1PE': { name: '1 Peter', nlt: '1Pet' },
  '2PE': { name: '2 Peter', nlt: '2Pet' },
  '1JN': { name: '1 John', nlt: '1John' },
  '2JN': { name: '2 John', nlt: '2John' },
  '3JN': { name: '3 John', nlt: '3John' },
  JUD: { name: 'Jude', nlt: 'Jude' },
  REV: { name: 'Revelation', nlt: 'Rev' },
};

export function bookNames(bookId: string): BookNames | undefined {
  return BOOKS[bookId.toUpperCase()];
}

export function isKnownBook(bookId: string): boolean {
  return bookId.toUpperCase() in BOOKS;
}
