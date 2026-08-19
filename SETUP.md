# Setup guide: repo, free hosting, the AI search function, and maintaining the library at scale

The site itself is a **static site** — HTML/CSS/JS, no database. The one
exception is the "describe your problem" search box, which calls a small
serverless function that in turn calls an LLM. That's the only piece of
this project with any recurring cost, and it's small — see the cost
summary at the bottom. Everything else stays at €0.

Everything below assumes basic git/GitHub familiarity, but no deeper
backend experience — there's nothing to run or babysit, only to configure
once.

---

## 1. Get the code into a GitHub repo

1. Create a new repository on GitHub (e.g. `personalization-use-case-library`).
2. Push this project to it:

   ```bash
   cd personalization-library
   git init
   git add .
   git commit -m "Initial personalization use case library"
   git branch -M main
   git remote add origin https://github.com/<your-org-or-user>/<repo-name>.git
   git push -u origin main
   ```

That's the entire "backend setup" for the code itself — GitHub is just
where the source lives; hosting happens in step 2.

---

## 2. Hosting: two supported paths

### Path A — Netlify (recommended: this is what you need for AI search)

The AI-powered problem search needs somewhere to run a small server-side
function (so your Anthropic API key never ends up in the browser). GitHub
Pages can't run server code, so if you want that feature, host on Netlify
instead — it serves the static site **and** the function together, still
deploys straight from your GitHub repo, and is still free at this scale.

1. Go to [app.netlify.com](https://app.netlify.com) and sign up (free —
   GitHub login works).
2. **Add a new site → Import an existing project → GitHub**, pick this repo.
3. Build settings: leave the build command **empty**, publish directory
   `.` (these are already set in `netlify.toml`, so Netlify should
   pre-fill them correctly).
4. Deploy. You'll get a URL like `https://your-site-name.netlify.app`
   within about a minute.
5. Every push to `main` redeploys automatically, including the function.

This also gives you free deploy previews for every pull request — handy
for reviewing a batch of new use cases before they go live.

### Path B — GitHub Pages (simpler, but no AI search)

If you don't want the AI search feature (the free keyword search and all
the filters still work great without it), GitHub Pages is the simplest
option and needs no third-party sign-up:

1. In the repo, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Branch: **main**, folder: **/ (root)**. Save.
4. Wait ~1 minute for the live URL to appear at the top of that page.

You can switch from Path B to Path A later at any time without changing
any code — the AI search box simply fails gracefully (with a message
pointing back to this doc) until it's deployed on a platform that runs
the function and has the API key configured.

**Other free alternatives to Netlify** that also run serverless functions:
Vercel and Cloudflare Pages both work, but the function in this repo is
written specifically for Netlify's function format. Porting it to Vercel
or Cloudflare Pages Functions is a small, mechanical change (same fetch
call to the Anthropic API, different request/response wrapper) if you'd
rather standardize on one of those instead.

### Optional: custom domain

Both Netlify and GitHub Pages support a custom domain
(e.g. `personalization.yourfirm.com`) for free — you only pay if you don't
already own the domain.

---

## 3. AI-powered problem search — setup

This is what powers the "Have a specific problem instead?" box, so a
consultant or client can type something like *"low open rate on our
lifecycle emails"* and get back ranked, relevant use cases with a
one-line rationale — instead of only being able to search by keyword.

### How it works

`netlify/functions/diagnose.js` is a small serverless function. The
browser sends it the freeform problem text; the function sends Claude the
full use-case catalog (id, title, one-liner, tags, and the business
problems each case already addresses) plus that text, and asks it — via a
forced tool call, so the response is always structured JSON, not prose to
parse — to return the 3-5 most relevant use case ids with a short
rationale each. The front-end then renders exactly those cards.

Your API key lives only on the server side (Netlify's environment
variables), never in the browser or the repo.

### Setup steps

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
   (**Settings → API Keys**). This requires putting a card on file with
   Anthropic directly — that's where the small usage-based cost applies
   (see cost summary below), separate from Netlify.
2. Pick a model. Check
   [docs.claude.com/en/docs/about-claude/models](https://docs.claude.com/en/docs/about-claude/models)
   for the current list — model ids change over time, so nothing is
   hardcoded in this repo. For this use case (matching a short problem
   description against ~26 short catalog entries), the smallest/fastest
   Claude model available is more than capable and keeps cost minimal;
   there's no need for a larger model here.
3. In Netlify: **Site configuration → Environment variables → Add a
   variable**, and add both:
   - `ANTHROPIC_API_KEY` — the key from step 1
   - `ANTHROPIC_MODEL` — the model id from step 2
4. Redeploy (Netlify → **Deploys → Trigger deploy**), so the function
   picks up the new environment variables.
5. Test it: open the live site, type a problem into the box, and confirm
   you get ranked matches back.

If either variable is missing, the function returns a clear error
message (visible in the UI) rather than failing silently.

### Testing locally before you deploy

```bash
npm install -g netlify-cli   # once
netlify login
netlify link                 # connect this folder to your Netlify site
netlify env:set ANTHROPIC_API_KEY "sk-ant-..."
netlify env:set ANTHROPIC_MODEL "<model id>"
netlify dev                  # serves the site + function locally, e.g. http://localhost:8888
```

`netlify dev` runs the exact same function code locally that will run in
production, so this is a faithful test, not a simulation.

### What if I never set this up?

Nothing breaks. The AI box shows a clear inline message ("this feature
needs the site deployed with an API key configured — see SETUP.md") and
everything else — keyword search, all the filters, the "Browse by
business problem" chips — works fully offline with zero configuration.
The business-problem filter chips already cover a good chunk of what the
AI box is for, just via clicking instead of typing a sentence.

---

## 4. How the app works (so maintenance makes sense)

- `index.html` loads `assets/js/app.js`, which `fetch()`es
  `data/use-cases.json` and `data/business-problems.json` and renders
  everything client-side.
- **Keyword search** is a small dependency-free fuzzy/keyword scorer in
  `app.js`, with a synonym dictionary (so "mobile app" matches things
  tagged `app`, "newsletter" matches `email`, "rewards" matches `loyalty`,
  etc. — extend `SYNONYM_WORDS`/`SYNONYM_PHRASES` at the top of `app.js`
  as you notice more gaps) and typo tolerance on longer words.
- **AI problem search** (optional, see section 3) handles genuinely
  freeform sentences the keyword search isn't meant to parse.
- **Filters** (business problem, channel, funnel stage, complexity, CDP
  maturity needed, quick win) are generated automatically from whatever
  values exist in the data files — you don't need to touch `app.js` to
  add a new *use case*, only if you want to add a new *filter category*.

---

## 5. Adding and tagging use cases at scale

This is the part designed for "lots of contributors, lots of use cases,
without it turning into a mess."

### The data model

Every use case is one JSON object in `data/use-cases.json`, validated
against `data/schema.json`. Required fields:

| Field | Purpose |
|---|---|
| `id` | Unique URL-safe slug, e.g. `browse-abandonment-recall` |
| `title`, `oneLiner` | What shows on the card |
| `channels` | `web`, `app`, and/or `email` — drives the channel filter |
| `funnelStage` | Awareness / Consideration / Onboarding / Conversion / Retention / Loyalty / Reactivation |
| `personalizationTactic` | Short label, e.g. "Behavioral retargeting" |
| `cdpDataUsed` | List of the CDP data points the use case relies on |
| `businessProblems` | Ids from `data/business-problems.json` — the client-facing problems this case addresses. This is what both the "Browse by business problem" filter and the AI search key off of. |
| `dataMaturity` | Foundational / Intermediate / Advanced — how much CDP capability a client needs first |
| `complexity` | Low / Medium / High implementation effort |
| `quickWin` | `true`/`false` — powers the "Quick wins only" filter |
| `journey`, `exampleBefore`, `exampleAfter` | The tangible story and copy example |
| `kpis.primary`, `kpis.secondary` | Impact metrics |
| `toolsNeeded` | What has to exist to build it |
| `tags` | Free-form keywords for keyword search (see tagging convention below) |

### The business-problem taxonomy

`data/business-problems.json` holds the canonical list of problems (`id`,
`label`, `description`) — things like `low-email-open-rate` or
`low-loyalty-engagement`. When you add a use case, reference existing
problem ids where they fit before adding a new one, the same way you'd
reuse an existing tag. If a genuinely new problem type comes up often
enough to be worth its own entry, add it to this file first (the schema's
enum list in `data/schema.json` needs the new id added too), then
reference it from use cases.

### Tagging convention (keep this consistent as the library grows)

Reuse existing tags before inventing new ones — check
`data/use-cases.json` for what's already used. A consistent pattern:

- **Channel** (redundant with `channels` but helps search): `web`, `app`, `email`
- **Data type**: `behavioral data`, `transactional data`, `declared data`,
  `zero-party data`, `predictive`
- **Tactic**: `retargeting`, `segmentation`, `dynamic content`,
  `triggered journey`, `search personalization`
- **Effort**: `quick win`, `low complexity`, `medium complexity`, `high complexity`
- **Funnel**: matches `funnelStage`, lowercase

All tags lowercase, no punctuation, 2–4 words max. This keeps the search
scoring meaningful — a huge pile of inconsistent one-off tags dilutes it.

### Option A — add one use case by hand

Copy an existing entry in `data/use-cases.json` as a template, edit it,
then validate:

```bash
pip install jsonschema   # once
python3 scripts/validate.py
```

The validator catches missing fields, wrong types, duplicate ids, and
invalid enum values (e.g. a typo'd `complexity` or an unrecognized
`businessProblems` id) before it ever reaches the live site.

### Option B — bulk import from a spreadsheet (recommended at scale)

This is the path for "a consultant collects 30 use cases from client
workshops and wants them all added at once" without anyone hand-editing
JSON:

1. Open `scripts/import_template.csv` in Excel/Google Sheets — it has the
   exact columns needed, with one filled-in example row.
2. Add rows. For list-type columns (`channels`, `cdpDataUsed`,
   `businessProblems`, `kpiSecondary`, `toolsNeeded`, `tags`), separate
   multiple values with `|` in the same cell, e.g. `web|app`.
3. Export as CSV.
4. Run:

   ```bash
   python3 scripts/import_csv.py your_file.csv --dry-run   # preview first
   python3 scripts/import_csv.py your_file.csv              # then apply
   python3 scripts/validate.py
   ```

   Rows whose `id` already exists update that entry in place; new ids are
   appended. This makes the script safe to re-run as a spreadsheet evolves.

### Reviewing and publishing new cases

Recommended flow once more than one or two people are contributing:

1. Contributor opens a pull request with their new/updated entries
   (whether hand-edited or via the CSV importer).
2. `.github/workflows/validate.yml` runs automatically on the PR and fails
   the check if anything doesn't match the schema — this is entirely free
   on GitHub's Actions minutes for a repo this size.
3. A reviewer skims the PR diff (JSON diffs are readable — you can see
   exactly what changed) and merges.
4. The site republishes automatically within about a minute (Netlify) —
   including the AI function picking up the updated catalog immediately,
   since it reads the data files fresh at deploy time.

For a small team, branch protection on `main` requiring the validation
check to pass (Settings → Branches → add rule) prevents a bad entry from
ever going live, with no extra tooling.

---

## 6. Cost summary

| Component | Cost |
|---|---|
| GitHub repo (public) | Free, unlimited |
| GitHub Actions (validation) | Free tier covers this easily (2,000 min/month on free plan) |
| Netlify hosting + functions | Free tier: 100GB bandwidth/month, 125k function requests/month — far beyond what a use-case library needs |
| Custom domain | Free to configure (you only pay if you buy a new domain) |
| Keyword search + filters | Free (runs entirely in the visitor's browser) |
| **AI problem search** | **Usage-based**, billed by Anthropic directly. Each query sends a short catalog (~26 short entries, a few hundred tokens) plus the problem text, and gets back a short structured response — on a small/fast model this is a fraction of a cent per query. Even at a few hundred searches a month, this is a few dollars, not a recurring subscription. |

**Total recurring cost: €0 for the core library. Cents-per-query, pay-as-you-go, only if you turn on AI search.**
