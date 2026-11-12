# Personalization Use Case Library

A searchable, filterable library of tangible personalization use cases —
built for consultants and clients who already have a CDP and good data
availability, but need a fast way to see (and pitch) what that data can
actually *do* for the end customer across web, app, and email.

Start by describing the business problem, choosing an industry, and optionally
prioritizing quick wins. The intake narrows the library, then the familiar
search and filters remain available for refining the results. Answers are
handled in the browser and are not saved.

Several ways to find something relevant:
- **Start with a mission or short brief** — choose a common goal or set a
  business problem and industry before opening results.
- **Refine one shortlist** — industry, business problem, channel, and effort
  filters are grouped together and can be removed from the active-filter row.
- **Filter by keyword** — use the small search control above the results;
  it’s fuzzy and typo-tolerant, with synonyms ("newsletter" matches `email`).
- **Match a situation with AI** — enter a plain-language description in the
  separate AI field to get ranked matches and explanations. This optional
  feature needs a small amount of setup and has a small usage-based cost —
  see SETUP.md.
- **Research new ideas with the crawler** — search the web for public
  personalization case studies and create source-linked drafts for review.
  Drafts are never added to the live library automatically. See
  **[SETUP.md](SETUP.md)** to configure and run the crawler.

**Mostly backend-free.** It's a static site: HTML, CSS, and vanilla
JavaScript, with all content in editable JSON files. The one exception is
the optional AI matching action, which needs a small serverless function — see
**[SETUP.md](SETUP.md)** for both the free-only path (GitHub Pages) and
the path with AI matching enabled (Netlify).

## What's in here

```
index.html                       the single page the whole app renders into
assets/css/style.css             all styling
assets/js/app.js                 search, filtering, synonyms, AI search wiring, detail panel
data/use-cases.json              the use cases — this is what you'll edit/extend
data/business-problems.json      the canonical "business problem" taxonomy used for filtering + AI matching
data/industries.json             the six industries used for the industry filter + AI matching
data/schema.json                 the validation schema for every use case entry
netlify/functions/diagnose.js    the AI problem-search function (optional — see SETUP.md)
netlify.toml                     Netlify config (static site + function)
scripts/validate.py              checks data/use-cases.json against the schema
scripts/import_csv.py            bulk-import new use cases from a CSV/spreadsheet
scripts/crawl_use_cases.py       searches public web pages and creates reviewable, source-linked drafts
scripts/import_crawl_drafts.py   validates and imports selected crawler drafts
scripts/import_template.csv      a filled-in example row to copy from
data/use-case-crawl-drafts.json  default output location for crawler drafts (generated locally)
.github/workflows/validate.yml   runs validate.py automatically on every push/PR
SETUP.md                         full hosting + maintenance instructions
```

## Try it locally

Browsers block JSON `fetch()` on files opened directly from disk, so run a
tiny local server instead of double-clicking `index.html`:

```bash
python3 -m http.server 8000
# then open http://localhost:8000 in your browser
```

This runs the site with keyword search, filters, and business-problem
browsing fully working. "Match my situation" will explain that AI matching
isn't configured and keep the text available for ordinary search until the
site is deployed per SETUP.md.

## Adding a use case

Include a concise `customerTrigger` (5–120 characters) describing the
customer action or event that starts the journey. The detail view uses it in
the first step of the customer-journey overview; keep the full story in
`journey`.

Two ways, both validated automatically:

1. **One-off:** add an entry to `data/use-cases.json` by hand (copy an
   existing one as a template), then run `python3 scripts/validate.py`.
2. **Bulk:** fill in a spreadsheet using `scripts/import_template.csv` as
   the column reference, export as CSV, then run
   `python3 scripts/import_csv.py your_file.csv`.

3. **Crawling:** To discover source material and generate draft ideas, you can also use the
optional research crawler in `scripts/crawl_use_cases.py`. It requires
Brave Search and Anthropic API credentials; review and selectively import
its output with `scripts/import_crawl_drafts.py`. See **[SETUP.md](SETUP.md)**
for configuration, commands, and the review workflow.

Full details, the business-problem taxonomy, tagging conventions, and the
maintenance, crawler, and review workflows are in **[SETUP.md](SETUP.md)**.
