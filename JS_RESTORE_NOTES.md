# JS files — restore notes

This zip does **not** include `assets/js/app.js` and
`netlify/functions/diagnose.js` (they couldn't be attached this round —
likely because raw `.js` attachments get blocked by mail providers). This
file describes exactly what they do and how, so a future session can
recreate them faithfully instead of guessing from scratch. Both files
previously existed and were verified working (rendering, filters, search,
detail panel, and the AI-search fallback were all tested in a browser).

## `assets/js/app.js` — required, the whole front end

Without this file the site renders nothing: `index.html` has empty
containers (`#filterGroups`, `#cardGrid`, detail panel) that only this
script populates. It's a single dependency-free vanilla-JS file (no
build step, no imports) that:

1. **Fetches three data files** on load: `data/use-cases.json`,
   `data/business-problems.json`, `data/industries.json` (relative to
   the site root, so it must run over http(s), not `file://`). On fetch
   failure it shows an inline error pointing to README.md.

2. **Renders filter chip groups** into `#filterGroups`, generated
   dynamically from the data (not hardcoded per use case), in this
   order: **Industry** (wide, from `data/industries.json`), **Business
   problem** (wide, from `data/business-problems.json`), **Channel**
   (`web`/`app`/`email`), **Funnel stage** (7 fixed values matching
   `data/schema.json`'s enum), **Complexity** (`Low`/`Medium`/`High`),
   **CDP maturity needed** (`Foundational`/`Intermediate`/`Advanced`),
   plus a separate **Quick wins only** toggle chip. Each chip toggles
   membership in a `Set` per filter key in `state.filters`; a use case
   must satisfy every active filter group (AND across groups, OR within
   a group — e.g. selecting two industries shows cases relevant to
   either one).

3. **Keyword search** (`#searchInput`) — dependency-free scorer over
   `title`, `oneLiner`, `personalizationTactic`, `journey`, `tags`,
   `cdpDataUsed`. Key design point (this was a real bug, fixed once):
   query words are split, then each word is expanded into a group of
   synonym *alternatives* (`SYNONYM_WORDS` / `SYNONYM_PHRASES` at the
   top of the file — e.g. "mobile app" → also matches `app`-tagged
   cases, "newsletter" → `email`). A card must match **at least one**
   alternative from **every** word-group (AND across the original
   words, OR within each word's synonym set). Getting this inverted
   (AND across all expanded synonyms) silently returns zero results —
   don't regress that. Words ≥5 chars also get typo tolerance via a
   capped Levenshtein distance (≤1) against haystack words ≥5 chars.

4. **AI search** (`#aiProblemInput` / `#aiSubmitBtn`) — POSTs
   `{ problem }` as JSON to `/.netlify/functions/diagnose`. Must
   tolerate the function not existing at all (static hosting, or a
   plain local server without `netlify dev`): wrap the response's
   `.json()` parse in its own try/catch (a 404/501/HTML error page
   isn't valid JSON) and show a graceful inline status message rather
   than throwing — the rest of the site (filters, keyword search) must
   keep working regardless. On success, results replace the card grid
   entirely (`state.aiResults`), each card gets an "AI match" rationale
   line, and a banner with a "← Back to browsing" button
   (`#aiClearBtn`) clears it. Changing any filter or the keyword search
   box also clears AI results.

5. **Card rendering** into `#cardGrid` — each card shows channel badges,
   a "Quick win" badge if applicable, title, one-liner, complexity/
   funnel/maturity pills, and (in AI mode) the rationale. Clicking a
   card opens the detail panel.

6. **Detail panel** (`#overlay` + `#detailPanel` + `#detailContent`) —
   slide-in panel built from scratch per open: eyebrow
   (personalizationTactic), title, one-liner, a badges row (funnel
   stage, complexity, maturity, channels, **and industry labels**),
   then sections for the journey narrative, before/after example boxes,
   business-problem pills, KPIs, CDP data used, and tools needed.
   Closes on the ✕ button, clicking the overlay, or Escape.

All DOM ids/classes it targets already exist in `index.html` /
`assets/css/style.css` — no markup or CSS changes are needed to restore
this file, only the JS logic itself.

## `netlify/functions/diagnose.js` — optional, AI search backend

A Netlify serverless function (CommonJS, `exports.handler`). Not required
for the site to work — SETUP.md documents that AI search degrades
gracefully without it. Behavior:

- Rejects non-POST with 405.
- Reads `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` from environment; if
  either is missing, returns 500 with a clear error message (never fails
  silently).
- Parses `{ problem }` from the JSON body; 400 if missing/empty.
- Reads all three data files directly off disk with `fs.readFileSync`
  (paths relative to `__dirname`: `../../data/use-cases.json`,
  `../../data/business-problems.json`, `../../data/industries.json`),
  so the catalog is always current at deploy time with no extra fetch.
- Builds a slim catalog (`id`, `title`, `oneLiner`, `tags`,
  `businessProblems`, `industries` per use case — not the full record)
  and calls `POST https://api.anthropic.com/v1/messages` with:
  - `system`: instructs the model to match the freeform problem against
    the catalog using the business-problem taxonomy and industries as
    context, and return the 3–5 best-fitting ids ranked, each with a
    one-sentence rationale.
  - A single user message containing the problem text (trimmed,
    capped at 500 chars) plus the taxonomy/industries/catalog as JSON.
  - A forced tool call (`tool_choice: { type: "tool", name:
    "return_matches" }`) with a JSON-schema tool (`return_matches`,
    1–5 items, each `{ id, rationale }`) so the response is always
    structured — no prose parsing.
- Validates returned ids against the real catalog (drops anything
  hallucinated) before responding `{ matches: [...] }` with 200.
- Any upstream failure → 502 with a generic "try again" message (logs
  the real error server-side only, never exposes the API response to
  the browser).

## Everything else in this zip is already up to date

The rest of the folder structure, data files (including the new
`industries` field/taxonomy), schema, validator, and import script were
already fixed and merged in a prior session — only these two JS files
are missing from *this* transfer.
