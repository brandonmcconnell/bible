import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/** Writes a file, creating parent directories as needed. */
export async function writeText(path: string, contents: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, contents, 'utf8');
}

/** Atomic write: write to a temp sibling, then rename over the target. */
export async function writeTextAtomic(path: string, contents: string): Promise<void> {
  await ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, contents, 'utf8');
  await rename(tmp, path);
}

export async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error: unknown) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

export async function removePath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/** Runs `worker` over `items` with at most `limit` concurrent invocations, preserving order. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  // A single shared iterator hands each item to exactly one worker.
  const queue = items.entries();
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (const [index, item] of queue) {
      results[index] = await worker(item, index);
    }
  });
  await Promise.all(runners);
  return results;
}
