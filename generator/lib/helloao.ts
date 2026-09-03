/**
 * Typed client for the Free Use Bible API (https://bible.helloao.org).
 *
 * Every response is decoded with runtime checks (see decode.ts) and cached on
 * disk so that rebuilding the site does not re-download several hundred
 * megabytes of scripture.
 */
import { join } from 'node:path';
import {
  decodeArray,
  expectArray,
  expectNumber,
  expectNumberArray,
  expectRecord,
  expectString,
  isRecord,
  optionalArray,
  optionalBoolean,
  optionalNumber,
  optionalString,
  optionalStringArray,
} from './decode.ts';
import { readTextIfExists, writeTextAtomic } from './fs.ts';

export const HELLOAO_BASE_URL = 'https://bible.helloao.org';

// ---------------------------------------------------------------------------
// Translations, books, chapters
// ---------------------------------------------------------------------------

export type TextDirection = 'ltr' | 'rtl';

export interface TranslationSummary {
  id: string;
  name: string;
  englishName: string;
  shortName: string;
  website: string;
  licenseUrl: string;
  /** ISO 639-3 language code, e.g. `eng`. */
  language: string;
  languageName: string | undefined;
  languageEnglishName: string | undefined;
  textDirection: TextDirection;
  numberOfBooks: number;
  totalNumberOfChapters: number;
  totalNumberOfVerses: number;
  numberOfApocryphalBooks: number | undefined;
}

export interface FormattedText {
  kind: 'text';
  text: string;
  /** Poetry indent level (1-based) when the text is a poem line. */
  poem: number | undefined;
  wordsOfJesus: boolean;
  descriptive: boolean;
}

export interface InlineHeading {
  kind: 'heading';
  heading: string;
}

export interface InlineLineBreak {
  kind: 'lineBreak';
}

export interface FootnoteReference {
  kind: 'note';
  noteId: number;
}

export type VersePart = string | FormattedText | InlineHeading | InlineLineBreak | FootnoteReference;

export interface ChapterHeading {
  type: 'heading';
  content: string[];
}

export interface ChapterLineBreak {
  type: 'line_break';
}

export interface ChapterVerse {
  type: 'verse';
  number: number;
  content: VersePart[];
}

export interface ChapterHebrewSubtitle {
  type: 'hebrew_subtitle';
  content: VersePart[];
}

export type ChapterItem = ChapterHeading | ChapterLineBreak | ChapterVerse | ChapterHebrewSubtitle;

export interface Footnote {
  noteId: number;
  text: string;
  /** `+` means "auto-generate a caller"; `null` means "no caller". */
  caller: string | null;
  reference: { chapter: number; verse: number } | undefined;
}

export interface ChapterData {
  number: number;
  content: ChapterItem[];
  footnotes: Footnote[];
}

export interface TranslationBook {
  /** USFM book identifier such as `GEN` or `1MA`. */
  id: string;
  /** The book name as provided by the translation (localized). */
  name: string;
  /** The English common name. */
  commonName: string;
  /** Longer descriptive title, when the translation provides one. */
  title: string | null;
  order: number;
  numberOfChapters: number;
  totalNumberOfVerses: number;
  chapters: ChapterData[];
}

export interface CompleteTranslation {
  translation: TranslationSummary;
  books: TranslationBook[];
}

function decodeTranslationSummary(value: unknown, ctx: string): TranslationSummary {
  const o = expectRecord(value, ctx);
  const direction = expectString(o.textDirection, `${ctx}.textDirection`);
  if (direction !== 'ltr' && direction !== 'rtl') {
    throw new Error(`${ctx}.textDirection: unexpected value ${direction}`);
  }
  return {
    id: expectString(o.id, `${ctx}.id`),
    name: expectString(o.name, `${ctx}.name`),
    englishName: expectString(o.englishName, `${ctx}.englishName`),
    shortName: expectString(o.shortName, `${ctx}.shortName`),
    website: expectString(o.website, `${ctx}.website`),
    licenseUrl: expectString(o.licenseUrl, `${ctx}.licenseUrl`),
    language: expectString(o.language, `${ctx}.language`),
    languageName: optionalString(o.languageName, `${ctx}.languageName`),
    languageEnglishName: optionalString(o.languageEnglishName, `${ctx}.languageEnglishName`),
    textDirection: direction,
    numberOfBooks: expectNumber(o.numberOfBooks, `${ctx}.numberOfBooks`),
    totalNumberOfChapters: expectNumber(o.totalNumberOfChapters, `${ctx}.totalNumberOfChapters`),
    totalNumberOfVerses: expectNumber(o.totalNumberOfVerses, `${ctx}.totalNumberOfVerses`),
    numberOfApocryphalBooks: optionalNumber(o.numberOfApocryphalBooks, `${ctx}.numberOfApocryphalBooks`),
  };
}

function decodeVersePart(value: unknown, ctx: string): VersePart {
  if (typeof value === 'string') return value;
  const o = expectRecord(value, ctx);
  if ('noteId' in o) return { kind: 'note', noteId: expectNumber(o.noteId, `${ctx}.noteId`) };
  if ('lineBreak' in o) return { kind: 'lineBreak' };
  if ('heading' in o) return { kind: 'heading', heading: expectString(o.heading, `${ctx}.heading`) };
  if ('text' in o) {
    return {
      kind: 'text',
      text: expectString(o.text, `${ctx}.text`),
      poem: optionalNumber(o.poem, `${ctx}.poem`),
      wordsOfJesus: optionalBoolean(o.wordsOfJesus, `${ctx}.wordsOfJesus`) ?? false,
      descriptive: optionalBoolean(o.descriptive, `${ctx}.descriptive`) ?? false,
    };
  }
  throw new Error(`${ctx}: unknown verse part with keys ${Object.keys(o).join(', ')}`);
}

function decodeChapterItem(value: unknown, ctx: string): ChapterItem {
  const o = expectRecord(value, ctx);
  const type = expectString(o.type, `${ctx}.type`);
  switch (type) {
    case 'heading':
      return {
        type,
        content: expectArray(o.content, `${ctx}.content`).map((s, i) => expectString(s, `${ctx}.content[${i}]`)),
      };
    case 'line_break':
      return { type };
    case 'verse':
      return {
        type,
        number: expectNumber(o.number, `${ctx}.number`),
        content: decodeArray(o.content, `${ctx}.content`, decodeVersePart),
      };
    case 'hebrew_subtitle':
      return { type, content: decodeArray(o.content, `${ctx}.content`, decodeVersePart) };
    default:
      throw new Error(`${ctx}.type: unknown chapter content type "${type}"`);
  }
}

function decodeFootnote(value: unknown, ctx: string): Footnote {
  const o = expectRecord(value, ctx);
  let reference: Footnote['reference'];
  if (isRecord(o.reference)) {
    reference = {
      chapter: expectNumber(o.reference.chapter, `${ctx}.reference.chapter`),
      verse: expectNumber(o.reference.verse, `${ctx}.reference.verse`),
    };
  }
  const caller = o.caller === null || o.caller === undefined ? null : expectString(o.caller, `${ctx}.caller`);
  return {
    noteId: expectNumber(o.noteId, `${ctx}.noteId`),
    text: expectString(o.text, `${ctx}.text`),
    caller,
    reference,
  };
}

function decodeChapterData(value: unknown, ctx: string): ChapterData {
  const o = expectRecord(value, ctx);
  return {
    number: expectNumber(o.number, `${ctx}.number`),
    content: decodeArray(o.content, `${ctx}.content`, decodeChapterItem),
    footnotes: optionalArray(o.footnotes, `${ctx}.footnotes`, decodeFootnote) ?? [],
  };
}

function decodeCompleteBook(value: unknown, ctx: string): TranslationBook {
  const o = expectRecord(value, ctx);
  const title = o.title === null || o.title === undefined ? null : expectString(o.title, `${ctx}.title`);
  const chapters = expectArray(o.chapters, `${ctx}.chapters`).map((entry, i) => {
    const wrapper = expectRecord(entry, `${ctx}.chapters[${i}]`);
    return decodeChapterData(wrapper.chapter, `${ctx}.chapters[${i}].chapter`);
  });
  return {
    id: expectString(o.id, `${ctx}.id`),
    name: expectString(o.name, `${ctx}.name`),
    commonName: expectString(o.commonName, `${ctx}.commonName`),
    title,
    order: expectNumber(o.order, `${ctx}.order`),
    numberOfChapters: expectNumber(o.numberOfChapters, `${ctx}.numberOfChapters`),
    totalNumberOfVerses: expectNumber(o.totalNumberOfVerses, `${ctx}.totalNumberOfVerses`),
    chapters,
  };
}

// ---------------------------------------------------------------------------
// Datasets: cross references and Theographic entities
// ---------------------------------------------------------------------------

export interface VerseRef {
  book: string;
  chapter: number;
  verse: number;
  endVerse: number | undefined;
}

export interface ScoredVerseRef extends VerseRef {
  score: number;
}

export interface CrossRefVerse {
  verse: number;
  references: ScoredVerseRef[];
}

export interface CrossRefChapter {
  number: number;
  content: CrossRefVerse[];
}

export interface DatasetBook {
  id: string;
  order: number;
  numberOfChapters: number;
  firstChapterNumber: number;
  lastChapterNumber: number | null;
}

export type EntityType = 'people' | 'places' | 'events' | 'groups';

export interface EntityRef {
  id: string;
  type: EntityType;
  name: string | undefined;
}

export interface ChapterPersonMention {
  id: string;
  name: string;
  verses: number[];
}

export interface ChapterPlaceMention {
  id: string;
  name: string;
  featureType: string | undefined;
  verses: number[];
}

export interface ChapterEventMention {
  id: string;
  name: string;
  startDate: string | undefined;
  verses: number[];
}

export interface EntityChapter {
  number: number;
  people: ChapterPersonMention[];
  places: ChapterPlaceMention[];
  events: ChapterEventMention[];
}

export interface PersonSummary {
  id: string;
  name: string;
  gender: string | undefined;
  numberOfReferences: number;
}

export interface Person {
  id: string;
  name: string;
  alsoCalled: string[] | undefined;
  gender: string | undefined;
  description: string[] | undefined;
  birthYear: number | undefined;
  deathYear: number | undefined;
  minYear: number | undefined;
  maxYear: number | undefined;
  birthPlace: EntityRef | undefined;
  deathPlace: EntityRef | undefined;
  father: EntityRef[] | undefined;
  mother: EntityRef[] | undefined;
  partners: EntityRef[] | undefined;
  children: EntityRef[] | undefined;
  siblings: EntityRef[] | undefined;
  halfSiblingsSameMother: EntityRef[] | undefined;
  halfSiblingsSameFather: EntityRef[] | undefined;
  memberOf: EntityRef[] | undefined;
  events: EntityRef[] | undefined;
  references: VerseRef[];
}

export interface PlaceSummary {
  id: string;
  name: string;
  featureType: string | undefined;
  latitude: number | undefined;
  longitude: number | undefined;
  numberOfReferences: number;
}

export interface Place {
  id: string;
  name: string;
  kjvName: string | undefined;
  esvName: string | undefined;
  aliases: string[] | undefined;
  featureType: string | undefined;
  featureSubType: string | undefined;
  latitude: number | undefined;
  longitude: number | undefined;
  precision: string | undefined;
  description: string[] | undefined;
  comment: string | undefined;
  rootPlace: EntityRef | undefined;
  duplicateOf: EntityRef | undefined;
  people: EntityRef[] | undefined;
  peopleBorn: EntityRef[] | undefined;
  peopleDied: EntityRef[] | undefined;
  events: EntityRef[] | undefined;
  references: VerseRef[];
}

export interface EventSummary {
  id: string;
  name: string;
  startDate: string | undefined;
  numberOfReferences: number;
}

export interface BibleEvent {
  id: string;
  name: string;
  startDate: string | undefined;
  duration: string | undefined;
  participants: EntityRef[] | undefined;
  locations: EntityRef[] | undefined;
  groups: EntityRef[] | undefined;
  partOf: EntityRef | undefined;
  predecessor: EntityRef | undefined;
  references: VerseRef[];
}

export interface PeopleGroupSummary {
  id: string;
  name: string;
  numberOfMembers: number;
}

export interface PeopleGroup {
  id: string;
  name: string;
  members: EntityRef[] | undefined;
  events: EntityRef[] | undefined;
  references: VerseRef[];
}

function decodeVerseRef(value: unknown, ctx: string): VerseRef {
  const o = expectRecord(value, ctx);
  return {
    book: expectString(o.book, `${ctx}.book`),
    chapter: expectNumber(o.chapter, `${ctx}.chapter`),
    verse: expectNumber(o.verse, `${ctx}.verse`),
    endVerse: optionalNumber(o.endVerse, `${ctx}.endVerse`),
  };
}

function decodeScoredVerseRef(value: unknown, ctx: string): ScoredVerseRef {
  const o = expectRecord(value, ctx);
  return { ...decodeVerseRef(value, ctx), score: optionalNumber(o.score, `${ctx}.score`) ?? 0 };
}

function decodeEntityType(value: unknown, ctx: string): EntityType {
  const type = expectString(value, ctx);
  if (type === 'people' || type === 'places' || type === 'events' || type === 'groups') return type;
  throw new Error(`${ctx}: unknown entity type "${type}"`);
}

function decodeEntityRef(value: unknown, ctx: string): EntityRef {
  const o = expectRecord(value, ctx);
  return {
    id: expectString(o.id, `${ctx}.id`),
    type: decodeEntityType(o.type, `${ctx}.type`),
    name: optionalString(o.name, `${ctx}.name`),
  };
}

function optionalEntityRef(value: unknown, ctx: string): EntityRef | undefined {
  if (value === undefined || value === null) return undefined;
  return decodeEntityRef(value, ctx);
}

function decodeDatasetBook(value: unknown, ctx: string): DatasetBook {
  const o = expectRecord(value, ctx);
  const last = o.lastChapterNumber;
  return {
    id: expectString(o.id, `${ctx}.id`),
    order: expectNumber(o.order, `${ctx}.order`),
    numberOfChapters: expectNumber(o.numberOfChapters, `${ctx}.numberOfChapters`),
    firstChapterNumber: expectNumber(o.firstChapterNumber, `${ctx}.firstChapterNumber`),
    lastChapterNumber: last === null || last === undefined ? null : expectNumber(last, `${ctx}.lastChapterNumber`),
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface HelloAoClientOptions {
  cacheDir: string;
  /** Maximum number of in-flight HTTP requests. */
  concurrency: number;
  /** Called after each network fetch (not for cache hits). */
  onFetch?: (path: string) => void;
}

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
    } else {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
      this.active += 1;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      const next = this.waiters.shift();
      if (next) next();
    };
  }
}

export class HelloAoClient {
  private readonly semaphore: Semaphore;
  private readonly cacheDir: string;
  private readonly onFetch: ((path: string) => void) | undefined;

  constructor(options: HelloAoClientOptions) {
    this.cacheDir = options.cacheDir;
    this.semaphore = new Semaphore(options.concurrency);
    this.onFetch = options.onFetch;
  }

  /** Fetches (or reads from cache) a JSON document by its API path, e.g. `/api/BSB/books.json`. */
  async getJson(apiPath: string): Promise<unknown> {
    const cachePath = join(this.cacheDir, apiPath.replace(/^\/+/, ''));
    const cached = await readTextIfExists(cachePath);
    if (cached !== undefined) return JSON.parse(cached) as unknown;

    const release = await this.semaphore.acquire();
    try {
      const text = await fetchWithRetry(`${HELLOAO_BASE_URL}${apiPath}`);
      this.onFetch?.(apiPath);
      // Validate JSON before caching so a truncated download never poisons the cache.
      const parsed = JSON.parse(text) as unknown;
      await writeTextAtomic(cachePath, text);
      return parsed;
    } finally {
      release();
    }
  }

  async availableTranslations(): Promise<TranslationSummary[]> {
    const o = expectRecord(await this.getJson('/api/available_translations.json'), 'available_translations');
    return decodeArray(o.translations, 'available_translations.translations', decodeTranslationSummary);
  }

  async completeTranslation(translationId: string): Promise<CompleteTranslation> {
    const ctx = `${translationId}/complete`;
    const o = expectRecord(await this.getJson(`/api/${translationId}/complete.json`), ctx);
    return {
      translation: decodeTranslationSummary(o.translation, `${ctx}.translation`),
      books: decodeArray(o.books, `${ctx}.books`, decodeCompleteBook),
    };
  }

  async datasetBooks(datasetId: string): Promise<DatasetBook[]> {
    const ctx = `d/${datasetId}/books`;
    const o = expectRecord(await this.getJson(`/api/d/${datasetId}/books.json`), ctx);
    return decodeArray(o.books, `${ctx}.books`, decodeDatasetBook);
  }

  async crossRefChapter(datasetId: string, bookId: string, chapter: number): Promise<CrossRefChapter> {
    const ctx = `d/${datasetId}/${bookId}/${chapter}`;
    const o = expectRecord(await this.getJson(`/api/d/${datasetId}/${bookId}/${chapter}.json`), ctx);
    const chapterData = expectRecord(o.chapter, `${ctx}.chapter`);
    return {
      number: expectNumber(chapterData.number, `${ctx}.chapter.number`),
      content: decodeArray(chapterData.content, `${ctx}.chapter.content`, (item, itemCtx) => {
        const v = expectRecord(item, itemCtx);
        return {
          verse: expectNumber(v.verse, `${itemCtx}.verse`),
          references: decodeArray(v.references, `${itemCtx}.references`, decodeScoredVerseRef),
        };
      }),
    };
  }

  async entityChapter(datasetId: string, bookId: string, chapter: number): Promise<EntityChapter> {
    const ctx = `d/${datasetId}/${bookId}/${chapter}`;
    const o = expectRecord(await this.getJson(`/api/d/${datasetId}/${bookId}/${chapter}.json`), ctx);
    const c = expectRecord(o.chapter, `${ctx}.chapter`);
    return {
      number: expectNumber(c.number, `${ctx}.chapter.number`),
      people: decodeArray(c.people ?? [], `${ctx}.chapter.people`, (item, itemCtx) => {
        const p = expectRecord(item, itemCtx);
        return {
          id: expectString(p.id, `${itemCtx}.id`),
          name: expectString(p.name, `${itemCtx}.name`),
          verses: expectNumberArray(p.verses, `${itemCtx}.verses`),
        };
      }),
      places: decodeArray(c.places ?? [], `${ctx}.chapter.places`, (item, itemCtx) => {
        const p = expectRecord(item, itemCtx);
        return {
          id: expectString(p.id, `${itemCtx}.id`),
          name: expectString(p.name, `${itemCtx}.name`),
          featureType: optionalString(p.featureType, `${itemCtx}.featureType`),
          verses: expectNumberArray(p.verses, `${itemCtx}.verses`),
        };
      }),
      events: decodeArray(c.events ?? [], `${ctx}.chapter.events`, (item, itemCtx) => {
        const e = expectRecord(item, itemCtx);
        return {
          id: expectString(e.id, `${itemCtx}.id`),
          name: expectString(e.name, `${itemCtx}.name`),
          startDate: optionalString(e.startDate, `${itemCtx}.startDate`),
          verses: expectNumberArray(e.verses, `${itemCtx}.verses`),
        };
      }),
    };
  }

  async people(datasetId: string): Promise<PersonSummary[]> {
    const ctx = `d/${datasetId}/people`;
    const o = expectRecord(await this.getJson(`/api/d/${datasetId}/people.json`), ctx);
    return decodeArray(o.people, `${ctx}.people`, (item, itemCtx) => {
      const p = expectRecord(item, itemCtx);
      return {
        id: expectString(p.id, `${itemCtx}.id`),
        name: expectString(p.name, `${itemCtx}.name`),
        gender: optionalString(p.gender, `${itemCtx}.gender`),
        numberOfReferences: expectNumber(p.numberOfReferences, `${itemCtx}.numberOfReferences`),
      };
    });
  }

  async person(datasetId: string, personId: string): Promise<Person> {
    const ctx = `d/${datasetId}/people/${personId}`;
    const o = expectRecord(await this.getJson(`/api/d/${datasetId}/people/${personId}.json`), ctx);
    const p = expectRecord(o.person, `${ctx}.person`);
    const refs = (key: string): EntityRef[] | undefined => optionalArray(p[key], `${ctx}.person.${key}`, decodeEntityRef);
    return {
      id: expectString(p.id, `${ctx}.person.id`),
      name: expectString(p.name, `${ctx}.person.name`),
      alsoCalled: optionalStringArray(p.alsoCalled, `${ctx}.person.alsoCalled`),
      gender: optionalString(p.gender, `${ctx}.person.gender`),
      description: optionalStringArray(p.description, `${ctx}.person.description`),
      birthYear: optionalNumber(p.birthYear, `${ctx}.person.birthYear`),
      deathYear: optionalNumber(p.deathYear, `${ctx}.person.deathYear`),
      minYear: optionalNumber(p.minYear, `${ctx}.person.minYear`),
      maxYear: optionalNumber(p.maxYear, `${ctx}.person.maxYear`),
      birthPlace: optionalEntityRef(p.birthPlace, `${ctx}.person.birthPlace`),
      deathPlace: optionalEntityRef(p.deathPlace, `${ctx}.person.deathPlace`),
      father: refs('father'),
      mother: refs('mother'),
      partners: refs('partners'),
      children: refs('children'),
      siblings: refs('siblings'),
      halfSiblingsSameMother: refs('halfSiblingsSameMother'),
      halfSiblingsSameFather: refs('halfSiblingsSameFather'),
      memberOf: refs('memberOf'),
      events: refs('events'),
      references: optionalArray(p.references, `${ctx}.person.references`, decodeVerseRef) ?? [],
    };
  }

  async places(datasetId: string): Promise<PlaceSummary[]> {
    const ctx = `d/${datasetId}/places`;
    const o = expectRecord(await this.getJson(`/api/d/${datasetId}/places.json`), ctx);
    return decodeArray(o.places, `${ctx}.places`, (item, itemCtx) => {
      const p = expectRecord(item, itemCtx);
      return {
        id: expectString(p.id, `${itemCtx}.id`),
        name: expectString(p.name, `${itemCtx}.name`),
        featureType: optionalString(p.featureType, `${itemCtx}.featureType`),
        latitude: optionalNumber(p.latitude, `${itemCtx}.latitude`),
        longitude: optionalNumber(p.longitude, `${itemCtx}.longitude`),
        numberOfReferences: expectNumber(p.numberOfReferences, `${itemCtx}.numberOfReferences`),
      };
    });
  }

  async place(datasetId: string, placeId: string): Promise<Place> {
    const ctx = `d/${datasetId}/places/${placeId}`;
    const o = expectRecord(await this.getJson(`/api/d/${datasetId}/places/${placeId}.json`), ctx);
    const p = expectRecord(o.place, `${ctx}.place`);
    const refs = (key: string): EntityRef[] | undefined => optionalArray(p[key], `${ctx}.place.${key}`, decodeEntityRef);
    return {
      id: expectString(p.id, `${ctx}.place.id`),
      name: expectString(p.name, `${ctx}.place.name`),
      kjvName: optionalString(p.kjvName, `${ctx}.place.kjvName`),
      esvName: optionalString(p.esvName, `${ctx}.place.esvName`),
      aliases: optionalStringArray(p.aliases, `${ctx}.place.aliases`),
      featureType: optionalString(p.featureType, `${ctx}.place.featureType`),
      featureSubType: optionalString(p.featureSubType, `${ctx}.place.featureSubType`),
      latitude: optionalNumber(p.latitude, `${ctx}.place.latitude`),
      longitude: optionalNumber(p.longitude, `${ctx}.place.longitude`),
      precision: optionalString(p.precision, `${ctx}.place.precision`),
      description: optionalStringArray(p.description, `${ctx}.place.description`),
      comment: optionalString(p.comment, `${ctx}.place.comment`),
      rootPlace: optionalEntityRef(p.rootPlace, `${ctx}.place.rootPlace`),
      duplicateOf: optionalEntityRef(p.duplicateOf, `${ctx}.place.duplicateOf`),
      people: refs('people'),
      peopleBorn: refs('peopleBorn'),
      peopleDied: refs('peopleDied'),
      events: refs('events'),
      references: optionalArray(p.references, `${ctx}.place.references`, decodeVerseRef) ?? [],
    };
  }

  async events(datasetId: string): Promise<EventSummary[]> {
    const ctx = `d/${datasetId}/events`;
    const o = expectRecord(await this.getJson(`/api/d/${datasetId}/events.json`), ctx);
    return decodeArray(o.events, `${ctx}.events`, (item, itemCtx) => {
      const e = expectRecord(item, itemCtx);
      return {
        id: expectString(e.id, `${itemCtx}.id`),
        name: expectString(e.name, `${itemCtx}.name`),
        startDate: optionalString(e.startDate, `${itemCtx}.startDate`),
        numberOfReferences: expectNumber(e.numberOfReferences, `${itemCtx}.numberOfReferences`),
      };
    });
  }

  async event(datasetId: string, eventId: string): Promise<BibleEvent> {
    const ctx = `d/${datasetId}/events/${eventId}`;
    const o = expectRecord(await this.getJson(`/api/d/${datasetId}/events/${eventId}.json`), ctx);
    const e = expectRecord(o.event, `${ctx}.event`);
    const refs = (key: string): EntityRef[] | undefined => optionalArray(e[key], `${ctx}.event.${key}`, decodeEntityRef);
    return {
      id: expectString(e.id, `${ctx}.event.id`),
      name: expectString(e.name, `${ctx}.event.name`),
      startDate: optionalString(e.startDate, `${ctx}.event.startDate`),
      duration: optionalString(e.duration, `${ctx}.event.duration`),
      participants: refs('participants'),
      locations: refs('locations'),
      groups: refs('groups'),
      partOf: optionalEntityRef(e.partOf, `${ctx}.event.partOf`),
      predecessor: optionalEntityRef(e.predecessor, `${ctx}.event.predecessor`),
      references: optionalArray(e.references, `${ctx}.event.references`, decodeVerseRef) ?? [],
    };
  }

  async peopleGroups(datasetId: string): Promise<PeopleGroupSummary[]> {
    const ctx = `d/${datasetId}/groups`;
    const o = expectRecord(await this.getJson(`/api/d/${datasetId}/groups.json`), ctx);
    return decodeArray(o.groups, `${ctx}.groups`, (item, itemCtx) => {
      const g = expectRecord(item, itemCtx);
      return {
        id: expectString(g.id, `${itemCtx}.id`),
        name: expectString(g.name, `${itemCtx}.name`),
        numberOfMembers: expectNumber(g.numberOfMembers, `${itemCtx}.numberOfMembers`),
      };
    });
  }

  async peopleGroup(datasetId: string, groupId: string): Promise<PeopleGroup> {
    const ctx = `d/${datasetId}/groups/${groupId}`;
    const o = expectRecord(await this.getJson(`/api/d/${datasetId}/groups/${groupId}.json`), ctx);
    const g = expectRecord(o.group, `${ctx}.group`);
    return {
      id: expectString(g.id, `${ctx}.group.id`),
      name: expectString(g.name, `${ctx}.group.name`),
      members: optionalArray(g.members, `${ctx}.group.members`, decodeEntityRef),
      events: optionalArray(g.events, `${ctx}.group.events`, decodeEntityRef),
      references: optionalArray(g.references, `${ctx}.group.references`, decodeVerseRef) ?? [],
    };
  }
}

class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

async function fetchWithRetry(url: string, attempts = 4): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} for ${url}`);
        // Client errors will not succeed on retry.
        if (response.status >= 400 && response.status < 500) throw error;
        throw new RetryableError(error.message);
      }
      return await response.text();
    } catch (error: unknown) {
      lastError = error;
      const retryable = error instanceof RetryableError || !(error instanceof Error) || error.name === 'TypeError';
      if (!retryable) throw error;
      if (attempt < attempts) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}
