/**
 * Cross references (OpenBible.info via the Free Use Bible API).
 *
 * They are language-neutral, so they are fetched once and used twice:
 *  - the top few references per verse are embedded as `data-xref` on each
 *    verse span so the stylesheet can render them with `::after`;
 *  - the full lists are written as compact static JSON
 *    (`/data/xref/<BOOK>/<chapter>.json`) for the reader script's popover.
 *
 * Each JSON verse entry is an array of `[book, chapter, verse, endVerse, score]`
 * tuples sorted by score (endVerse is 0 when the reference is a single verse).
 */
import { join } from 'node:path';
import { mapConcurrent, writeText } from './fs.ts';
import type { CrossRefChapter, HelloAoClient } from './helloao.ts';

export type CrossRefTuple = [book: string, chapter: number, verse: number, endVerse: number, score: number];

export interface CrossRefFile {
  [verse: string]: CrossRefTuple[];
}

export type CrossRefIndex = Map<string, CrossRefChapter>;

export function crossRefKey(bookId: string, chapter: number): string {
  return `${bookId}:${chapter}`;
}

export interface CrossRefBuildResult {
  index: CrossRefIndex;
  files: number;
  references: number;
}

export async function buildCrossReferences(
  client: HelloAoClient,
  datasetId: string,
  outputDir: string,
  concurrency: number,
  filter: ((bookId: string, chapter: number) => boolean) | undefined,
  onProgress: (done: number, total: number) => void,
): Promise<CrossRefBuildResult> {
  const books = await client.datasetBooks(datasetId);
  const targets: Array<{ bookId: string; chapter: number }> = [];
  for (const book of books) {
    const last = book.lastChapterNumber ?? book.firstChapterNumber + book.numberOfChapters - 1;
    for (let chapter = book.firstChapterNumber; chapter <= last; chapter += 1) {
      if (!filter || filter(book.id, chapter)) targets.push({ bookId: book.id, chapter });
    }
  }

  const index: CrossRefIndex = new Map();
  let done = 0;
  let references = 0;
  await mapConcurrent(targets, concurrency, async ({ bookId, chapter }) => {
    const data = await client.crossRefChapter(datasetId, bookId, chapter);
    const sorted: CrossRefChapter = {
      number: data.number,
      content: data.content.map((verse) => ({
        verse: verse.verse,
        references: [...verse.references].sort((a, b) => b.score - a.score),
      })),
    };
    index.set(crossRefKey(bookId, chapter), sorted);

    const file: CrossRefFile = {};
    for (const verse of sorted.content) {
      if (verse.references.length === 0) continue;
      file[String(verse.verse)] = verse.references.map<CrossRefTuple>((ref) => [ref.book, ref.chapter, ref.verse, ref.endVerse ?? 0, ref.score]);
      references += verse.references.length;
    }
    await writeText(join(outputDir, bookId, `${chapter}.json`), JSON.stringify(file));
    done += 1;
    onProgress(done, targets.length);
  });

  return { index, files: targets.length, references };
}
