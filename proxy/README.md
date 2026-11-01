# Bible proxy

A small [Cloudflare Worker](https://workers.cloudflare.com/) that serves **licensed** translations (ESV, NLT, NKJV, NASB, CSB, AMP, MSG, …) to the site.

Why it exists: the publishers of these translations do not allow their text to be stored or republished, which is what the rest of this repository does with public-domain texts. They do offer APIs under non-commercial terms (per-page copyright notice, no more than ~500 verses stored, API key kept secret). So the site generates the *navigation* for these translations and fetches each chapter from this proxy when a reader opens it. The proxy holds the keys, accepts only single-chapter requests, and normalizes the three providers into one JSON format.

```
GET /v1/status                              → { ok, providers: { esv, nlt, "api-bible" } }
GET /v1/:provider/:edition/:BOOK/:chapter   → normalized chapter JSON
```

| Provider | `edition` | Key | Where to get it | Terms (summary; read the originals) |
| --- | --- | --- | --- | --- |
| `esv` | `esv` | `ESV_API_KEY` | [api.esv.org](https://api.esv.org/) → create an API application | Non-commercial sites only. 5,000 requests/day, 1,000/hour, 60/minute across *all* visitors. Max 500 verses or half a book per page. Copyright notice + link to esv.org on every page. Crossway also asks that use be consistent with its statement of faith. |
| `nlt` | `NLT`, `NLTUK`, `NTV` | `NLT_API_KEY` (optional) | [api.nlt.to](https://api.nlt.to/) → register | Works anonymously (50 verses/request, 500 requests/day); a free key raises that to 500 verses and 5,000 requests/day. Non-commercial. |
| `api-bible` | a bible id, or an abbreviation such as `NKJV`, `NASB2020`, `CSB`, `AMP`, `MSG`, `GNT`, `CEV` | `API_BIBLE_KEY` | [scripture.api.bible](https://scripture.api.bible/) → create an app, then add the copyrighted Bibles you want to it (Starter plan: up to 3; Pro: more, per-translation fees for commercial use) | Non-commercial by default. Copyright notice with every display. Fair Use Management System (FUMS) reporting is required; the reader script does this with the `fumsToken` the proxy returns. Cached content must be refreshed within 30 days. |

Not obtainable through any API: **NIV** (Biblica licenses it directly: [biblica.com/permissions](https://www.biblica.com/permissions/)), **NRSVue** (Petradi Rights Management), **LSB**, **CEB**. Those need a negotiated license with the rights holder; once you have one that includes API or file delivery, add a provider under `src/providers/`.

## Deploy

```bash
cd proxy
npm install
npx wrangler login
npx wrangler secret put ESV_API_KEY        # paste the key
npx wrangler secret put NLT_API_KEY        # optional
npx wrangler secret put API_BIBLE_KEY
# edit wrangler.toml: ALLOWED_ORIGINS = "https://your-docs-domain.com"
npx wrangler deploy
```

Wrangler prints the worker URL (e.g. `https://bible-proxy.<account>.workers.dev`). Then tell the site where it is:

1. In the GitHub repository, add an Actions variable `BIBLE_PROXY_URL` with that URL (Settings → Secrets and variables → Actions → Variables).
2. Run the **Regenerate content** workflow (or locally: `BIBLE_PROXY_URL=https://… npm run build`) and merge the resulting pull request.

Until the URL is set, the licensed chapter pages exist but show a "not configured" notice.

### API.Bible edition lookup

`edition` can be an abbreviation; the proxy lists the Bibles available to your key and matches `abbreviation`/`abbreviationLocal` case-insensitively, preferring English. If a lookup is ambiguous or fails, pin it in `wrangler.toml`:

```toml
[vars]
API_BIBLE_IDS = "NKJV=de4e12af7f28f599-02,NASB2020=a761ca71e0b3ddcf-01"
```

Find ids at `https://api.scripture.api.bible/v1/bibles` (with your key) or in the API.Bible dashboard.

## Run locally

```bash
cd proxy
ESV_API_KEY=… API_BIBLE_KEY=… npm run dev     # http://localhost:8787
```

The NLT works without a key, so `npm run dev` with no variables is enough to see a licensed translation working:

```bash
BIBLE_PROXY_URL=http://localhost:8787 npm run build:sample   # in the repository root
npm run dev                                                   # mint dev; open /en/nlt/john/1
```

## Adding a licensed translation to the site

Edit `generator/config.ts` → the `licensed` list of a language. Each entry needs a `slug`, `label`, `name`, `provider`, `edition`, the `copyright` notice the publisher requires and its `website`. Book/chapter structure is borrowed from the KJV (override with `structureFrom` for a translation with a different canon).

## Response format

```jsonc
{
  "provider": "nlt", "edition": "NLT", "book": "JHN", "chapter": 1,
  "content": [
    { "type": "heading", "text": "Prologue: Christ, the Eternal Word" },
    { "type": "subtitle", "text": "A psalm of David." },
    { "type": "line_break" },
    { "type": "verse", "number": 1, "parts": [
      "plain text",
      { "text": "poetry line", "poem": 1, "wordsOfJesus": true },
      { "noteId": 0 },
      { "lineBreak": true }
    ] }
  ],
  "footnotes": [ { "noteId": 0, "text": "1:3-4 Or …" } ],
  "copyright": "Scripture quotations marked (NLT) …",
  "fumsToken": "…"            // API.Bible only
}
```

## What the proxy does not do

- It does not store text. ESV responses are `Cache-Control: no-store`; others are browser-cacheable for a day.
- It does not rate-limit per visitor. The publishers' daily caps apply to your key as a whole, so a busy site can exhaust the ESV's 5,000 requests/day. Put the worker behind Cloudflare's rate limiting rules if that becomes a problem, or request a formal license from Crossway.
- It does not make a site commercial-use compliant. If the site ever charges, carries ads or solicits donations, every one of these licenses changes.
