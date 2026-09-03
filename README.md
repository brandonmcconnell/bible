# The Bible, as a Mintlify site

Every book, chapter and verse of the Bible published as a [Mintlify](https://mintlify.com) documentation site, with the
translation switcher backed by Mintlify **versions** and the language switcher backed by Mintlify **languages**.

Nothing under the language folders is written by hand. A TypeScript generator discovers every translation the
[Free Use Bible API](https://bible.helloao.org/) offers in a language Mintlify can represent and writes the MDX pages
(~120,000 of them), the navigation tree, seven verse-by-verse commentaries, cross-reference data and a study section
(people, places, events and maps). Re-run it any time to pick up new translations or upstream fixes.

## What you get

| Feature | How it works |
| --- | --- |
| **Every translation the API offers in a Mintlify language: 123 translations in 26 languages** (51 in English alone, from the KJV and BSB to the Geneva Bible, Wycliffe, the Septuagint in English and the JPS Tanakh) | One Mintlify `version` per translation, one Mintlify `language` per language. Translations are discovered from the API at build time; `generator/config.ts` only holds the ISO→Mintlify language map and curated slugs/labels/defaults. The remaining 1,133 translations are in 978 languages Mintlify has no language code for (Sanskrit, Koine Greek, Latin, and hundreds of minority languages) and are skipped, with a count printed by the build. |
| **Seven commentaries** (Matthew Henry, Jamieson-Fausset-Brown, John Gill, Adam Clarke, John Calvin, Keil & Delitzsch, Tyndale Open Study Notes) | A *Commentaries* tab with a dropdown per commentary; one page per chapter with the commentary's introduction and verse-by-verse notes, each note linking to the verse. Every English chapter page links to the commentaries that cover it. |
| **Every verse is its own `<span class="v">`** | Verse numbers are drawn with `::before { content: attr(data-v) }`; cross references with `::after { content: attr(data-xref) }`. The scripture text itself stays clean and copyable. |
| **Deuterocanon / Apocrypha handled per translation** | Translations only get the books they actually contain. Protestant translations put extra books in an *Apocrypha* group; Catholic translations (Douay-Rheims) interleave them in the traditional Old Testament order. Missing chapters and verses simply do not appear. |
| **Footnotes** | Inline markers with hover tooltips plus a footnote list at the end of each chapter. Toggleable. |
| **Poetry, headings, red-letter text** | Poem lines keep their indentation, section headings appear in the table of contents, and the words of Jesus are red where the translation marks them. All toggleable. |
| **Cross references** | 344,799 references from [OpenBible.info](https://www.openbible.info/labs/cross-references/). The top three per verse are embedded for the CSS `::after` display; the full list opens in a panel from the verse action bar. |
| **Study section** | 3,067 people, 1,274 places (with OpenStreetMap embeds), 450 events on a timeline and 23 people groups from [Theographic Bible Metadata](https://github.com/robertrouse/theographic-bible-metadata), each linking to the passages that mention them. Every English chapter lists the people, places and events it contains. |
| **Reader toolbar (custom JS)** | Translation switcher that keeps you in the same chapter, text size, and toggles for verse numbers, footnotes, headings, cross references, red letter and serif font. Settings persist in `localStorage`. |
| **Verse selection** | Click verses to select them, then copy them with bracketed verse numbers and their reference (`[1] In the beginning… — Genesis 1:1 (KJV)`), copy a deep link (`#v3-5`), or open cross references. `←`/`→` move between chapters. |
| **Sidebar chapter grid** | Books are plain dropdowns in the sidebar; expanding one shows an *Overview* entry and the chapter numbers as a wrapping grid of squares so a whole book is visible at a glance. |
| **Right-to-left** | Hebrew and Arabic chapters render RTL, including verse numbers and the toolbar. |

## Repository layout

```
docs.json                 Generated. Site settings from generator/site.ts + navigation $refs
navigation/<lang>.json    Generated. One Mintlify language block (versions → tabs → groups → pages)
<lang>/<translation>/     Generated. index.mdx, <book>/index.mdx, <book>/<chapter>.mdx
en/study/                 Generated. people/, places/, events/, groups/
en/commentary/            Generated. <commentary>/index.mdx, <commentary>/<book>/index.mdx, <commentary>/<book>/<chapter>.mdx
data/xref/<BOOK>/<n>.json Generated. Cross references per chapter
theme/bible.css           Hand-written. Reader styles (verse numbers, footnotes, poetry, toolbar…)
theme/bible-reader.js     Hand-written. Reader toolbar, selection, copy, cross-reference panel
theme/bible-manifest.js   Generated. Translations/books/chapters + UI strings for the reader script
generator/                The TypeScript generator (ignored by Mintlify via .mintignore)
logo/, favicon.svg        Branding
```

Mintlify includes every `.css` and `.js` file in the content directory on every page, which is how the theme and the
reader script are loaded without any configuration.

## Regenerating the site

```bash
npm install
npm run build          # full build (a few minutes with a warm cache; the first run downloads ~1 GB of API data)
npm run dev            # mint dev on http://localhost:3000
npm run validate       # mint validate
```

Useful flags:

```bash
npm run build:sample                               # a few books/chapters in en, es, he for quick iteration
npm run build -- --translations=eng_kjv,BSB        # only some translation ids
npm run build -- --no-study --no-xref --no-commentaries   # skip optional sections
npm run build -- --inline-navigation               # write navigation into docs.json instead of $ref files
npm run clean                                      # delete generated output
```

API responses are cached in `.cache/` (git-ignored). Delete it to force a fresh download.

### Controlling which translations are published

Translations are discovered automatically, so a new translation in the API appears on the next build. What you can tune
in `generator/config.ts`:

- `LANGUAGES` maps ISO 639-3 codes from the API to Mintlify language codes. Only languages listed here can be
  published (Mintlify accepts a fixed set of codes). UI strings live in `generator/lib/i18n.ts`; anything missing
  falls back to English.
- `curated` holds per-translation overrides keyed by API id: `slug`, `label`, `name`, `default`, `tag`, `canon`
  (`'catholic'` interleaves the deuterocanon; otherwise extra books get their own group), `extraBooksLabel`,
  `language` (e.g. Traditional Chinese) and `exclude`. Anything not curated gets a slug and label derived from the
  API's short name and an automatic tag (*Apocrypha*, *Catholic*, *NT*, *OT* or *Partial*).
- `minBooks` drops small portions (single books, selections); it is `0` by default so everything is included.
- Each language can opt into `study` (Theographic data, English) and `commentaries` (`'all'` or a list of ids).

The `Regenerate content` GitHub Actions workflow does the same on demand (or monthly) and opens a pull request.

## How the generator works

1. `generator/lib/helloao.ts` — a typed client for the Free Use Bible API. Every response is validated at runtime and
   cached on disk. A translation is a single `complete.json` download; datasets and commentaries are fetched per
   chapter/entity with bounded concurrency.
2. `generator/lib/model.ts` — turns the API's book list into sections (Old Testament, New Testament, Apocrypha /
   Deuterocanon) using the canon tables in `generator/lib/books.ts`. URL slugs are language-neutral so the same chapter
   has the same path in every translation (`/en/kjv/genesis/1`, `/fr/lsg/genesis/1`).
3. `generator/lib/render.ts` — renders chapters to MDX: paragraphs, poetry lines, headings (as Markdown `##` so they
   reach the table of contents), footnote markers, Hebrew subtitles, pilcrow paragraph marks, and `data-xref`.
4. `generator/lib/study.ts`, `generator/lib/commentary.ts` and `generator/lib/xref.ts` — the study pages,
   commentary pages and cross-reference files.
5. `generator/lib/nav.ts` and `generator/build.ts` — the Mintlify navigation (`languages → versions → tabs → groups →
   pages`), `docs.json`, redirects and the client manifest.

## Content licenses

Scripture text, commentaries, cross references and study data are **not** covered by this repository's MIT license.
Each translation and commentary page links to its own license; everything the API offers is public domain or openly
licensed (mostly via [eBible.org](https://ebible.org/) and [berean.bible](https://berean.bible/)). Cross references are
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (OpenBible.info) and Theographic data is
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). All of it is served through the
[Free Use Bible API](https://bible.helloao.org/).

The code in this repository is MIT licensed — see [LICENSE](LICENSE).
