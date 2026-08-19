# Personalization Use Case Library

A searchable, filterable library of tangible personalization use cases —
built for consultants and clients who already have a CDP and good data
availability, but need a fast way to see (and pitch) what that data can
actually *do* for the end customer across web, app, and email.

Three ways to find something relevant:
- **Browse by business problem** — "low email open rate", "low loyalty
  engagement", "high cart abandonment", etc. — the filter chips at the top.
- **Keyword search** — fuzzy, typo-tolerant, with synonyms built in
  ("mobile app" matches things tagged `app`, "newsletter" matches `email`).
- **Describe your problem in plain language** — "we have low engagement
  with our loyalty program" — and an AI reads the whole library and
  returns the most relevant cases with a rationale for each. (Optional;
  needs a small amount of setup and has a small usage-based cost — see
  SETUP.md. Everything else on this page works with zero cost or setup.)

**Mostly backend-free.** It's a static site: HTML, CSS, and vanilla
JavaScript, with all content in editable JSON files. The one exception is
the AI search box, which needs a small serverless function — see
**[SETUP.md](SETUP.md)** for both the free-only path (GitHub Pages) and
the path with AI search enabled (Netlify).

## What's in here

```
index.html                       the single page the whole app renders into
assets/css/style.css             all styling
assets/js/app.js                 search, filtering, synonyms, AI search wiring, detail panel
data/use-cases.json              the 26 use cases — this is what you'll edit/extend
data/business-problems.json      the canonical "business problem" taxonomy used for filtering + AI matching
data/schema.json                 the validation schema for every use case entry
netlify/functions/diagnose.js    the AI problem-search function (optional — see SETUP.md)
netlify.toml                     Netlify config (static site + function)
scripts/validate.py              checks data/use-cases.json against the schema
scripts/import_csv.py            bulk-import new use cases from a CSV/spreadsheet
scripts/import_template.csv      a filled-in example row to copy from
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
browsing fully working. The AI search box will show a graceful "not
configured" message until it's deployed per SETUP.md — that's expected,
not a bug.

## Adding a use case

Two ways, both validated automatically:

1. **One-off:** add an entry to `data/use-cases.json` by hand (copy an
   existing one as a template), then run `python3 scripts/validate.py`.
2. **Bulk:** fill in a spreadsheet using `scripts/import_template.csv` as
   the column reference, export as CSV, then run
   `python3 scripts/import_csv.py your_file.csv`.

Full details, the business-problem taxonomy, tagging conventions, and the
review workflow are in **[SETUP.md](SETUP.md)**.
