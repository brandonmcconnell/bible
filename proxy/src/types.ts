/**
 * The normalized chapter format every provider adapter produces. It mirrors
 * the Free Use Bible API's chapter shape closely enough that the reader
 * script renders both the same way.
 */

export interface LiveFormattedText {
  text: string;
  /** Poetry indent level (1-based). */
  poem?: number;
  wordsOfJesus?: boolean;
}

export interface LiveNoteRef {
  noteId: number;
}

export interface LiveLineBreak {
  lineBreak: true;
}

export type LivePart = string | LiveFormattedText | LiveNoteRef | LiveLineBreak;

export interface LiveHeading {
  type: 'heading';
  text: string;
}

export interface LiveSubtitle {
  type: 'subtitle';
  text: string;
}

export interface LiveParagraphBreak {
  type: 'line_break';
}

export interface LiveVerse {
  type: 'verse';
  number: number;
  parts: LivePart[];
}

export type LiveItem = LiveHeading | LiveSubtitle | LiveParagraphBreak | LiveVerse;

export interface LiveFootnote {
  noteId: number;
  text: string;
}

export interface LiveChapter {
  provider: string;
  edition: string;
  book: string;
  chapter: number;
  content: LiveItem[];
  footnotes: LiveFootnote[];
  /** Copyright notice the provider requires alongside the text, when it supplies one. */
  copyright?: string;
  /** API.Bible Fair Use Management System token; the client must load the FUMS script for it. */
  fumsToken?: string;
}

export interface ProviderEnv {
  ESV_API_KEY?: string;
  NLT_API_KEY?: string;
  API_BIBLE_KEY?: string;
  /** Optional `ABBR=bibleId,ABBR=bibleId` overrides for API.Bible edition lookup. */
  API_BIBLE_IDS?: string;
  /** Comma-separated list of allowed browser origins; `*` allows any. */
  ALLOWED_ORIGINS?: string;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface Provider {
  readonly id: string;
  isConfigured(env: ProviderEnv): boolean;
  fetchChapter(env: ProviderEnv, edition: string, book: string, chapter: number): Promise<LiveChapter>;
}
