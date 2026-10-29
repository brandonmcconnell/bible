/**
 * The "Study" section: people, places, events and people groups from the
 * Theographic Bible Metadata dataset, plus a chronological timeline. Every
 * page is generated; scripture references link into the language's default
 * translation.
 */
import { canonicalOrder, englishBookName } from './books.ts';
import { mapConcurrent, writeText } from './fs.ts';
import type {
  BibleEvent,
  EntityChapter,
  EntityRef,
  EventSummary,
  HelloAoClient,
  PeopleGroup,
  PeopleGroupSummary,
  Person,
  PersonSummary,
  Place,
  PlaceSummary,
  VerseRef,
} from './helloao.ts';
import type { UiStrings } from './i18n.ts';
import { escapeAttr, escapeHeading, escapeText, formatYear, frontmatter } from './mdx.ts';
import type { PublishedTranslation } from './model.ts';
import type { NavGroup, NavTab } from './nav.ts';
import { entitySlug } from './render.ts';

export interface StudyBuildOptions {
  client: HelloAoClient;
  datasetId: string;
  /** Page path prefix, e.g. `en/study`. */
  basePath: string;
  /** Translation whose chapters scripture references link to. */
  linkTranslation: PublishedTranslation;
  ui: UiStrings;
  concurrency: number;
  /** When set, only entities whose id is in this set are generated (sample builds). */
  limitEntities: number | undefined;
  onProgress: (message: string) => void;
}

export interface StudyBuildResult {
  tab: NavTab;
  pages: number;
  /** Chapter-level mentions keyed by `BOOK:chapter`, for "In this chapter" sections. */
  chapterEntities: Map<string, EntityChapter>;
}

const MAX_REFERENCES_SHOWN = 400;

export async function buildStudySection(options: StudyBuildOptions): Promise<StudyBuildResult> {
  const { client, datasetId, basePath, ui, concurrency, onProgress } = options;
  const link = new ReferenceLinker(options.linkTranslation, basePath);

  onProgress('Fetching entity lists');
  const [peopleList, placeList, eventList, groupList, datasetBooks] = await Promise.all([
    client.people(datasetId),
    client.places(datasetId),
    client.events(datasetId),
    client.peopleGroups(datasetId),
    client.datasetBooks(datasetId),
  ]);

  const limit = <T>(items: T[]): T[] => (options.limitEntities === undefined ? items : items.slice(0, options.limitEntities));
  const people = limit(sortByName(peopleList));
  const places = limit(sortByName(placeList));
  const events = limit(sortByDate(eventList));
  const groups = limit(sortByName(groupList));

  let pages = 0;

  // People -----------------------------------------------------------------
  onProgress(`Rendering ${people.length} people`);
  await mapConcurrent(people, concurrency, async (summary) => {
    const person = await client.person(datasetId, summary.id);
    await writeText(`${basePath}/people/${entitySlug(person.id)}.mdx`, renderPerson(person, ui, link));
    pages += 1;
  });
  await writeText(`${basePath}/people/index.mdx`, renderAlphabeticalIndex(ui.people, people, `/${basePath}/people`, ui, (p) => p.numberOfReferences));
  pages += 1;

  // Places -----------------------------------------------------------------
  onProgress(`Rendering ${places.length} places`);
  await mapConcurrent(places, concurrency, async (summary) => {
    const place = await client.place(datasetId, summary.id);
    await writeText(`${basePath}/places/${entitySlug(place.id)}.mdx`, renderPlace(place, ui, link));
    pages += 1;
  });
  await writeText(`${basePath}/places/index.mdx`, renderAlphabeticalIndex(ui.places, places, `/${basePath}/places`, ui, (p) => p.numberOfReferences));
  pages += 1;

  // Events -----------------------------------------------------------------
  onProgress(`Rendering ${events.length} events`);
  const fullEvents = await mapConcurrent(events, concurrency, async (summary) => {
    const event = await client.event(datasetId, summary.id);
    await writeText(`${basePath}/events/${entitySlug(event.id)}.mdx`, renderEvent(event, ui, link));
    pages += 1;
    return event;
  });
  await writeText(`${basePath}/events/index.mdx`, renderTimeline(fullEvents, ui, link, `/${basePath}/events`));
  pages += 1;

  // People groups ----------------------------------------------------------
  onProgress(`Rendering ${groups.length} people groups`);
  await mapConcurrent(groups, concurrency, async (summary) => {
    const group = await client.peopleGroup(datasetId, summary.id);
    await writeText(`${basePath}/groups/${entitySlug(group.id)}.mdx`, renderGroup(group, ui, link));
    pages += 1;
  });
  await writeText(`${basePath}/groups/index.mdx`, renderGroupIndex(groups, ui, `/${basePath}/groups`));
  pages += 1;

  // Overview ---------------------------------------------------------------
  await writeText(`${basePath}/index.mdx`, renderStudyOverview(ui, basePath, { people: people.length, places: places.length, events: events.length, groups: groups.length }));
  pages += 1;

  // Chapter mentions -------------------------------------------------------
  onProgress('Fetching chapter mentions');
  const chapterTargets: Array<{ bookId: string; chapter: number }> = [];
  for (const book of datasetBooks) {
    const last = book.lastChapterNumber ?? book.firstChapterNumber + book.numberOfChapters - 1;
    for (let chapter = book.firstChapterNumber; chapter <= last; chapter += 1) chapterTargets.push({ bookId: book.id, chapter });
  }
  const chapterEntities = new Map<string, EntityChapter>();
  await mapConcurrent(chapterTargets, concurrency, async ({ bookId, chapter }) => {
    try {
      const data = await client.entityChapter(datasetId, bookId, chapter);
      chapterEntities.set(`${bookId}:${chapter}`, data);
    } catch (error: unknown) {
      // Some chapters have no entity data; the API returns 404 for them.
      if (!(error instanceof Error && /HTTP 404/.test(error.message))) throw error;
    }
  });

  const tab: NavTab = {
    tab: ui.study,
    icon: 'library',
    groups: [
      { group: ui.overview, pages: [`${basePath}/index`] },
      { group: ui.people, icon: 'users', root: `${basePath}/people/index`, pages: letterGroups(people, `${basePath}/people`) },
      { group: ui.places, icon: 'map-pin', root: `${basePath}/places/index`, pages: letterGroups(places, `${basePath}/places`) },
      { group: ui.events, icon: 'calendar-days', root: `${basePath}/events/index`, pages: eventGroups(fullEvents, `${basePath}/events`) },
      { group: ui.peopleGroups, icon: 'users-round', root: `${basePath}/groups/index`, pages: groups.map((g) => `${basePath}/groups/${entitySlug(g.id)}`) },
    ],
  };

  return { tab, pages, chapterEntities };
}

// ---------------------------------------------------------------------------
// Linking helpers
// ---------------------------------------------------------------------------

class ReferenceLinker {
  constructor(
    private readonly translation: PublishedTranslation,
    private readonly studyBasePath: string,
  ) {}

  /** Markdown for a single verse reference, linking into the default translation when the book exists. */
  verse(ref: VerseRef): string {
    const book = this.translation.bookById.get(ref.book);
    const name = book?.name ?? englishBookName(ref.book);
    const verses = ref.endVerse !== undefined && ref.endVerse !== ref.verse ? `${ref.verse}–${ref.endVerse}` : String(ref.verse);
    const label = `${name} ${ref.chapter}:${verses}`;
    if (!book || !book.chapters.some((c) => c.number === ref.chapter)) return escapeText(label);
    return `[${escapeText(label)}](/${book.path}/${ref.chapter}#v${ref.verse})`;
  }

  /** References grouped by book, e.g. `**Genesis** 2:19–21, 3:8`. */
  referenceList(refs: readonly VerseRef[]): string[] {
    const shown = refs.slice(0, MAX_REFERENCES_SHOWN);
    const byBook = new Map<string, VerseRef[]>();
    for (const ref of shown) {
      const list = byBook.get(ref.book) ?? [];
      list.push(ref);
      byBook.set(ref.book, list);
    }
    const lines = [...byBook.entries()]
      .sort(([a], [b]) => canonicalOrder(a) - canonicalOrder(b))
      .map(([bookId, list]) => {
        const book = this.translation.bookById.get(bookId);
        const name = book?.name ?? englishBookName(bookId);
        const items = list.map((ref) => {
          const verses = ref.endVerse !== undefined && ref.endVerse !== ref.verse ? `${ref.verse}–${ref.endVerse}` : String(ref.verse);
          const label = `${ref.chapter}:${verses}`;
          if (!book || !book.chapters.some((c) => c.number === ref.chapter)) return escapeText(label);
          return `[${label}](/${book.path}/${ref.chapter}#v${ref.verse})`;
        });
        return `- **${escapeText(name)}** ${items.join(', ')}`;
      });
    if (refs.length > shown.length) lines.push(`- … ${refs.length - shown.length} more`);
    return lines;
  }

  entity(ref: EntityRef): string {
    const name = ref.name ?? ref.id;
    return `[${escapeText(name)}](/${this.studyBasePath}/${ref.type}/${entitySlug(ref.id)})`;
  }

  entities(refs: readonly EntityRef[] | undefined): string | undefined {
    if (!refs || refs.length === 0) return undefined;
    return refs.map((ref) => this.entity(ref)).join(', ');
  }
}

// ---------------------------------------------------------------------------
// Sorting / grouping
// ---------------------------------------------------------------------------

function sortByName<T extends { name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

function sortByDate<T extends { startDate: string | undefined; name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const ya = dateSortKey(a.startDate);
    const yb = dateSortKey(b.startDate);
    if (ya !== yb) return ya - yb;
    return a.name.localeCompare(b.name, 'en');
  });
}

function dateSortKey(date: string | undefined): number {
  if (!date) return Number.MAX_SAFE_INTEGER;
  const match = /^(-?\d+)(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(date.trim());
  if (!match) return Number.MAX_SAFE_INTEGER;
  const year = Number(match[1]);
  const month = match[2] !== undefined ? Number(match[2]) : 0;
  const day = match[3] !== undefined ? Number(match[3]) : 0;
  return year * 10000 + month * 100 + day;
}

function formatDate(date: string | undefined): string | undefined {
  if (!date) return undefined;
  const match = /^(-?\d+)(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(date.trim());
  if (!match) return date;
  const year = Number(match[1]);
  const base = formatYear(year);
  if (match[2] === undefined) return base;
  const month = match[2].padStart(2, '0');
  return match[3] === undefined ? `${base} (${month})` : `${base} (${month}-${match[3].padStart(2, '0')})`;
}

function formatDuration(duration: string | undefined): string | undefined {
  if (!duration) return undefined;
  const match = /^(\d+)([DWMY])$/.exec(duration.trim());
  if (!match) return duration;
  const count = Number(match[1]);
  const unit = { D: 'day', W: 'week', M: 'month', Y: 'year' }[match[2] ?? 'D'] ?? 'day';
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

function letterOf(name: string): string {
  const first = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : '#';
}

function letterGroups<T extends { id: string; name: string }>(items: readonly T[], basePath: string): NavGroup[] {
  const buckets = new Map<string, string[]>();
  for (const item of items) {
    const letter = letterOf(item.name);
    const list = buckets.get(letter) ?? [];
    list.push(`${basePath}/${entitySlug(item.id)}`);
    buckets.set(letter, list);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)))
    .map(([letter, pages]) => ({ group: letter, pages }));
}

function eventGroups(events: readonly BibleEvent[], basePath: string): NavGroup[] {
  const buckets = new Map<string, string[]>();
  for (const event of events) {
    const first = event.references[0];
    const key = first ? first.book : 'other';
    const list = buckets.get(key) ?? [];
    list.push(`${basePath}/${entitySlug(event.id)}`);
    buckets.set(key, list);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => canonicalOrder(a) - canonicalOrder(b))
    .map(([bookId, pages]) => ({ group: bookId === 'other' ? 'Other' : englishBookName(bookId), pages }));
}

// ---------------------------------------------------------------------------
// Page renderers
// ---------------------------------------------------------------------------

/** First sentence-ish summary for frontmatter descriptions, cut at a word boundary. */
function summarize(paragraphs: readonly string[] | undefined, max = 160): string | undefined {
  const text = paragraphs?.[0]?.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > max * 0.6 ? cut.slice(0, boundary) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

function paragraphsOf(paragraphs: readonly string[] | undefined): string[] {
  return (paragraphs ?? []).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length > 0);
}

function factRows(rows: Array<[label: string, value: string | undefined]>): string[] {
  const lines: string[] = [];
  for (const [label, value] of rows) {
    if (value === undefined || value.length === 0) continue;
    lines.push(`<div className="fact"><span className="factk">${escapeText(label)}</span><span className="factv">${value}</span></div>`);
  }
  if (lines.length === 0) return [];
  return ['<div className="facts">', ...lines, '</div>', ''];
}

function renderPerson(person: Person, ui: UiStrings, link: ReferenceLinker): string {
  const lifespan =
    person.birthYear !== undefined || person.deathYear !== undefined
      ? `${person.birthYear !== undefined ? formatYear(person.birthYear) : '?'} – ${person.deathYear !== undefined ? formatYear(person.deathYear) : '?'}`
      : undefined;
  const halfSiblings = [...(person.halfSiblingsSameFather ?? []), ...(person.halfSiblingsSameMother ?? [])];
  const lines: string[] = [
    frontmatter({
      title: person.name,
      description: summarize(person.description),
      icon: 'user',
    }),
    '<div className="bible-entity" data-type="person">',
    '',
    ...factRows([
      [ui.alsoCalled, person.alsoCalled?.map(escapeText).join(', ')],
      [ui.gender, person.gender !== undefined ? escapeText(person.gender) : undefined],
      [ui.born, person.birthYear !== undefined ? escapeText(formatYear(person.birthYear)) : undefined],
      [ui.died, person.deathYear !== undefined ? escapeText(formatYear(person.deathYear)) : undefined],
      [`${ui.born} · ${ui.places}`, person.birthPlace ? link.entity(person.birthPlace) : undefined],
      [`${ui.died} · ${ui.places}`, person.deathPlace ? link.entity(person.deathPlace) : undefined],
      [ui.father, link.entities(person.father)],
      [ui.mother, link.entities(person.mother)],
      [ui.partners, link.entities(person.partners)],
      [ui.children, link.entities(person.children)],
      [ui.siblings, link.entities(person.siblings)],
      [ui.halfSiblings, link.entities(halfSiblings)],
      [ui.memberOf, link.entities(person.memberOf)],
      [ui.events, link.entities(person.events)],
      [ui.timeline, lifespan === undefined && person.minYear !== undefined ? escapeText(`${formatYear(person.minYear)} – ${formatYear(person.maxYear ?? person.minYear)}`) : undefined],
    ]),
  ];
  for (const paragraph of paragraphsOf(person.description)) lines.push(escapeText(paragraph), '');
  if (person.references.length > 0) {
    lines.push(`## ${escapeHeading(ui.mentionedIn)}`, '', ...link.referenceList(person.references), '');
  }
  lines.push('</div>', '');
  return lines.join('\n');
}

function renderPlace(place: Place, ui: UiStrings, link: ReferenceLinker): string {
  const lines: string[] = [
    frontmatter({
      title: place.name,
      description: summarize(place.description) ?? place.featureType,
      icon: 'map-pin',
    }),
    '<div className="bible-entity" data-type="place">',
    '',
  ];
  if (place.latitude !== undefined && place.longitude !== undefined) {
    lines.push(renderMap(place.name, place.latitude, place.longitude, ui), '');
  }
  const aliases = [...new Set([...(place.aliases ?? []), place.kjvName, place.esvName].filter((n): n is string => n !== undefined && n !== place.name))];
  lines.push(
    ...factRows([
      [ui.featureType, place.featureType ? escapeText(place.featureSubType ? `${place.featureType} · ${place.featureSubType}` : place.featureType) : undefined],
      [ui.alsoCalled, aliases.length > 0 ? aliases.map(escapeText).join(', ') : undefined],
      ['Coordinates', place.latitude !== undefined && place.longitude !== undefined ? escapeText(`${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}${place.precision ? ` (${place.precision})` : ''}`) : undefined],
      ['Root place', place.rootPlace ? link.entity(place.rootPlace) : undefined],
      ['Duplicate of', place.duplicateOf ? link.entity(place.duplicateOf) : undefined],
      [ui.people, link.entities(place.people)],
      [`${ui.people} · ${ui.born}`, link.entities(place.peopleBorn)],
      [`${ui.people} · ${ui.died}`, link.entities(place.peopleDied)],
      [ui.events, link.entities(place.events)],
    ]),
  );
  for (const paragraph of paragraphsOf(place.description)) lines.push(escapeText(paragraph), '');
  if (place.comment) lines.push(`> ${escapeText(place.comment)}`, '');
  if (place.references.length > 0) {
    lines.push(`## ${escapeHeading(ui.mentionedIn)}`, '', ...link.referenceList(place.references), '');
  }
  lines.push('</div>', '');
  return lines.join('\n');
}

function renderMap(name: string, latitude: number, longitude: number, ui: UiStrings): string {
  const dLon = 0.6;
  const dLat = 0.4;
  const bbox = [longitude - dLon, latitude - dLat, longitude + dLon, latitude + dLat].map((n) => n.toFixed(4)).join(',');
  const embed = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  const open = `https://www.openstreetmap.org/?mlat=${latitude.toFixed(5)}&mlon=${longitude.toFixed(5)}#map=9/${latitude.toFixed(4)}/${longitude.toFixed(4)}`;
  return [
    '<div className="bmap-wrap">',
    `<iframe className="bmap" src="${embed}" loading="lazy" title="${escapeAttr(`${ui.map}: ${name}`)}" referrerPolicy="no-referrer-when-downgrade"></iframe>`,
    `<a className="bmap-link" href="${open}" target="_blank" rel="noreferrer">${escapeText(ui.openInMaps)} ↗</a>`,
    '</div>',
  ].join('\n');
}

function renderEvent(event: BibleEvent, ui: UiStrings, link: ReferenceLinker): string {
  const lines: string[] = [
    frontmatter({
      title: event.name,
      description: formatDate(event.startDate),
      icon: 'calendar-days',
    }),
    '<div className="bible-entity" data-type="event">',
    '',
    ...factRows([
      [ui.date, event.startDate ? escapeText(formatDate(event.startDate) ?? event.startDate) : undefined],
      [ui.duration, event.duration ? escapeText(formatDuration(event.duration) ?? event.duration) : undefined],
      [ui.participants, link.entities(event.participants)],
      [ui.locations, link.entities(event.locations)],
      [ui.peopleGroups, link.entities(event.groups)],
      [ui.partOf, event.partOf ? link.entity(event.partOf) : undefined],
      [ui.predecessor, event.predecessor ? link.entity(event.predecessor) : undefined],
    ]),
  ];
  if (event.references.length > 0) {
    lines.push(`## ${escapeHeading(ui.references)}`, '', ...link.referenceList(event.references), '');
  }
  lines.push('</div>', '');
  return lines.join('\n');
}

function renderGroup(group: PeopleGroup, ui: UiStrings, link: ReferenceLinker): string {
  const lines: string[] = [
    frontmatter({ title: group.name, icon: 'users-round' }),
    '<div className="bible-entity" data-type="group">',
    '',
    ...factRows([[ui.events, link.entities(group.events)]]),
  ];
  if (group.members && group.members.length > 0) {
    lines.push(`## ${escapeHeading(ui.members)}`, '', '<div className="entgrid">');
    for (const member of sortByName(group.members.map((m) => ({ ...m, name: m.name ?? m.id })))) {
      lines.push(`<span className="ent">${link.entity(member)}</span>`);
    }
    lines.push('</div>', '');
  }
  if (group.references.length > 0) {
    lines.push(`## ${escapeHeading(ui.mentionedIn)}`, '', ...link.referenceList(group.references), '');
  }
  lines.push('</div>', '');
  return lines.join('\n');
}

function renderAlphabeticalIndex<T extends { id: string; name: string }>(
  title: string,
  items: readonly T[],
  basePath: string,
  ui: UiStrings,
  count: (item: T) => number,
): string {
  const lines: string[] = [
    frontmatter({ title, sidebarTitle: ui.overview, description: `${items.length.toLocaleString('en')} ${title.toLowerCase()}` }),
    '<div className="bible-index">',
    '',
  ];
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const letter = letterOf(item.name);
    const list = buckets.get(letter) ?? [];
    list.push(item);
    buckets.set(letter, list);
  }
  for (const [letter, list] of [...buckets.entries()].sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)))) {
    lines.push(`## ${letter}`, '', '<div className="entgrid">');
    for (const item of list) {
      lines.push(`<span className="ent">[${escapeText(item.name)}](${basePath}/${entitySlug(item.id)})<span className="entv">${count(item)}</span></span>`);
    }
    lines.push('</div>', '');
  }
  lines.push('</div>', '');
  return lines.join('\n');
}

function renderTimeline(events: readonly BibleEvent[], ui: UiStrings, link: ReferenceLinker, basePath: string): string {
  const lines: string[] = [
    frontmatter({ title: ui.events, sidebarTitle: ui.overview, description: ui.timeline }),
    '<div className="bible-index bible-timeline">',
    '',
    `| ${escapeText(ui.date)} | ${escapeText(ui.events)} | ${escapeText(ui.references)} |`,
    '| --- | --- | --- |',
  ];
  for (const event of sortByDate(events)) {
    const first = event.references[0];
    const date = formatDate(event.startDate) ?? '';
    lines.push(`| ${escapeText(date)} | [${escapeText(event.name)}](${basePath}/${entitySlug(event.id)}) | ${first ? link.verse(first) : ''} |`);
  }
  lines.push('', '</div>', '');
  return lines.join('\n');
}

function renderGroupIndex(groups: readonly PeopleGroupSummary[], ui: UiStrings, basePath: string): string {
  const lines: string[] = [
    frontmatter({ title: ui.peopleGroups, sidebarTitle: ui.overview }),
    '<div className="bible-index">',
    '<div className="entgrid">',
  ];
  for (const group of groups) {
    lines.push(`<span className="ent">[${escapeText(group.name)}](${basePath}/${entitySlug(group.id)})<span className="entv">${group.numberOfMembers}</span></span>`);
  }
  lines.push('</div>', '</div>', '');
  return lines.join('\n');
}

function renderStudyOverview(
  ui: UiStrings,
  basePath: string,
  counts: { people: number; places: number; events: number; groups: number },
): string {
  const fmt = (n: number): string => n.toLocaleString('en');
  return [
    frontmatter({ title: ui.study, sidebarTitle: ui.overview, description: ui.studyIntro, icon: 'library' }),
    '<Columns cols={2}>',
    `  <Card title="${escapeAttr(ui.people)}" icon="users" href="/${basePath}/people">${fmt(counts.people)} ${escapeText(ui.people.toLowerCase())}</Card>`,
    `  <Card title="${escapeAttr(ui.places)}" icon="map-pin" href="/${basePath}/places">${fmt(counts.places)} ${escapeText(ui.places.toLowerCase())} · ${escapeText(ui.map)}</Card>`,
    `  <Card title="${escapeAttr(ui.events)}" icon="calendar-days" href="/${basePath}/events">${fmt(counts.events)} ${escapeText(ui.events.toLowerCase())} · ${escapeText(ui.timeline)}</Card>`,
    `  <Card title="${escapeAttr(ui.peopleGroups)}" icon="users-round" href="/${basePath}/groups">${fmt(counts.groups)} ${escapeText(ui.peopleGroups.toLowerCase())}</Card>`,
    '</Columns>',
    '',
    `## ${escapeHeading(ui.crossReferences)}`,
    '',
    escapeText(
      'Every verse page can show cross references from the OpenBible.info dataset. Turn them on with the reading toolbar; they appear after each verse and open a list of linked passages.',
    ),
    '',
    `## ${escapeHeading(ui.source)}`,
    '',
    '- [Theographic Bible Metadata](https://github.com/robertrouse/theographic-bible-metadata) (CC BY-SA 4.0)',
    '- [OpenBible.info cross references](https://www.openbible.info/labs/cross-references/) (CC BY 4.0)',
    '- Served through the [Free Use Bible API](https://bible.helloao.org/)',
    '',
  ].join('\n');
}

export type { EventSummary, PersonSummary, PlaceSummary };
