/*
  Personalization Use Case Library — front-end logic.
  No frameworks, no build step, no external dependencies.
  Data lives in JSON files under data/ — edit those files (or use scripts/import_csv.py)
  to add cases or taxonomy values; this file changes only for a new *filter type*.
*/

(function () {
  "use strict";

  const state = {
    all: [],
    problemsById: {},
    industriesById: {},
    categoriesById: {},
    saved: [], // ordered use-case ids the visitor has saved to a shortlist
    detailId: null,
    browsingStarted: false,
    editingBrief: false,
    query: "",
    filters: {
      industries: new Set(),
      channels: new Set(),
      funnelStage: new Set(),
      complexity: new Set(),
      dataMaturity: new Set(),
      businessProblems: new Set(),
      dataAvailable: new Set(), // data categories the client already has (readiness filter)
      quickWin: false,
    },
    ai: {
      active: false,
      problem: "",
      matches: [], // [{ id, rationale }]
    },
  };

  const JOURNEY_STAGES = [
    "Awareness",
    "Consideration",
    "Onboarding",
    "Conversion",
    "Retention",
    "Loyalty",
    "Reactivation",
  ];

  const els = {
    grid: document.getElementById("cardGrid"),
    resultsArea: document.getElementById("resultsArea"),
    intakePanel: document.getElementById("intakePanel"),
    intakeForm: document.getElementById("intakeForm"),
    intakeProblem: document.getElementById("intakeProblem"),
    intakeIndustry: document.getElementById("intakeIndustry"),
    intakeFunnelStage: document.getElementById("intakeFunnelStage"),
    industryCards: document.getElementById("industryCards"),
    browseAllBtn: document.getElementById("browseAllBtn"),
    missionShortcuts: document.querySelectorAll(".mission-card"),
    briefBar: document.getElementById("briefBar"),
    briefSummary: document.getElementById("briefSummary"),
    editBriefBtn: document.getElementById("editBriefBtn"),
    aiProblemInput: document.getElementById("aiProblemInput"),
    resultCount: document.getElementById("resultCount"),
    keywordSearchInput: document.getElementById("keywordSearchInput"),
    clearKeywordSearch: document.getElementById("clearKeywordSearch"),
    filterGroups: document.getElementById("filterGroups"),
    emptyState: document.getElementById("emptyState"),
    overlay: document.getElementById("overlay"),
    detailPanel: document.getElementById("detailPanel"),
    detailContent: document.getElementById("detailContent"),
    aiSubmitBtn: document.getElementById("aiSubmitBtn"),
    aiStatus: document.getElementById("aiStatus"),
    aiResultsBanner: document.getElementById("aiResultsBanner"),
    aiResultsText: document.getElementById("aiResultsText"),
    aiClearBtn: document.getElementById("aiClearBtn"),
    searchPanel: document.querySelector(".search-panel"),
    activeFilters: document.getElementById("activeFilters"),
    refinePanel: document.getElementById("refinePanel"),
    readinessHint: document.getElementById("readinessHint"),
    shareBtn: document.getElementById("shareBtn"),
    tray: document.getElementById("shortlistTray"),
    trayCount: document.getElementById("trayCount"),
    trayReview: document.getElementById("trayReview"),
    trayShare: document.getElementById("trayShare"),
    trayClear: document.getElementById("trayClear"),
    modal: document.getElementById("shortlistModal"),
    modalBody: document.getElementById("shortlistBody"),
    modalCount: document.getElementById("shortlistModalCount"),
    modalClose: document.getElementById("shortlistClose"),
    printSheet: document.getElementById("printSheet"),
    toast: document.getElementById("toast"),
  };

  // ---------- Data loading ----------

  Promise.all([
    fetch("data/use-cases.json", { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status + " loading use-cases.json");
      return r.json();
    }),
    fetch("data/business-problems.json", { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status + " loading business-problems.json");
      return r.json();
    }),
    fetch("data/industries.json", { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status + " loading industries.json");
      return r.json();
    }),
    // Optional taxonomy: if it can't be loaded the library still works, just without the data-readiness filter.
    fetch("data/data-categories.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { categories: [] }))
      .catch(() => ({ categories: [] })),
  ])
    .then(([useCaseData, problemData, industryData, categoryData]) => {
      state.all = useCaseData.useCases || [];
      (categoryData.categories || []).forEach((category) => {
        state.categoriesById[category.id] = category;
      });
      (problemData.problems || []).forEach((p) => {
        state.problemsById[p.id] = p;
      });
      (industryData.industries || []).forEach((industry) => {
        state.industriesById[industry.id] = industry;
      });
      populateIntakeOptions();
      buildIndustryCards();
      buildFilterGroups();
      const restored = restoreFromURL();
      if (restored.browse) {
        // A shared or bookmarked link: rebuild the same shortlist, then jump to it.
        els.intakeProblem.value = state.filters.businessProblems.values().next().value || "";
        els.intakeIndustry.value = state.filters.industries.values().next().value || "";
        els.intakeFunnelStage.value = state.filters.funnelStage.values().next().value || "";
        render();
        scrollToSection(els.resultsArea);
        if (restored.caseId) openDetail(restored.caseId);
      } else {
        if (restored.caseId) openDetail(restored.caseId);
        render();
        const navigationEntries = window.performance && window.performance.getEntriesByType
          ? window.performance.getEntriesByType("navigation")
          : [];
        if (navigationEntries.length && navigationEntries[0].type === "reload") {
          window.scrollTo(0, 0);
        }
      }
    })
    .catch((err) => {
      els.resultsArea.hidden = false;
      els.grid.innerHTML =
        '<p class="empty-state">Could not load the library data (' +
        err.message +
        "). If you're opening this file directly (file://), run a local server instead — see SETUP.md.</p>";
    });

  // ---------- Synonyms ----------
  // Fixes queries like "mobile app" or "newsletter" not matching cases tagged
  // "app" / "email". Multi-word phrases are normalized first, then individual
  // words are mapped to a canonical term before scoring.

  const SYNONYM_PHRASES = [
    [/\bmobile app(s)?\b/g, "app"],
    [/\bweb ?site(s)?\b/g, "web"],
    [/\bwin[- ]?back\b/g, "winback"],
    [/\bcome[- ]?back\b/g, "return"],
    [/\bopt[- ]?out(s)?\b/g, "unsubscribe"],
    [/\bsign[- ]?up(s)?\b/g, "signup"],
    [/\bpush notification(s)?\b/g, "push"],
  ];

  const SYNONYM_WORDS = {
    mobile: "app", ios: "app", android: "app", application: "app", apps: "app",
    newsletter: "email", newsletters: "email", "e-mail": "email", emails: "email", mail: "email",
    website: "web", site: "web", sites: "web", desktop: "web", browser: "web",
    rewards: "loyalty", reward: "loyalty", points: "loyalty", membership: "loyalty", vip: "loyalty",
    churn: "winback", reactivation: "winback", lapsed: "winback", dormant: "winback", winback: "winback",
    remarketing: "retargeting", retargeted: "retargeting",
    personalisation: "personalization", personalise: "personalize", personalised: "personalized", tailored: "personalized", custom: "personalized",
    basket: "cart",
    coupon: "discount", promo: "discount", offer: "discount", offers: "discount", sale: "discount",
    notifications: "push", notification: "push",
    discovery: "search", navigation: "search", browsing: "search", searching: "search",
    opens: "open", "open-rate": "open",
    unsub: "unsubscribe", unsubscribed: "unsubscribe", unsubscribing: "unsubscribe",
    returns: "return", exchange: "return", exchanges: "return",
    reviews: "review", ratings: "review", ugc: "review",
    ads: "ad", advertising: "ad", advert: "ad",
    survey: "quiz", surveys: "quiz",
    signup: "signup", signups: "signup",
    buy: "purchase", buys: "purchase", bought: "purchase", buying: "purchase", purchases: "purchase",
    rates: "rate",
  };

  const QUERY_STOP_WORDS = new Set([
    "a", "about", "after", "again", "all", "also", "am", "an", "and", "any", "are", "as", "at",
    "be", "because", "been", "before", "being", "between", "both", "but", "by", "can", "could",
    "did", "do", "does", "doing", "down", "during", "each", "few", "for", "from", "further",
    "had", "has", "have", "having", "he", "her", "here", "hers", "herself", "him", "himself",
    "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "just", "me", "more",
    "most", "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other",
    "our", "ours", "ourselves", "out", "over", "own", "same", "she", "should", "so", "some",
    "such", "than", "that", "the", "their", "theirs", "them", "themselves", "then", "there",
    "these", "they", "this", "those", "through", "to", "too", "under", "until", "up", "us",
    "very", "was", "we", "were", "what", "when", "where", "which", "while", "who", "whom",
    "why", "will", "with", "would", "you", "your", "yours", "yourself", "yourselves",
    "don", "doesn", "didn", "isn", "aren", "wasn", "weren", "won", "wouldn", "couldn", "shouldn",
    "s", "t", "better", "decrease", "find", "get", "help", "improve", "increase", "looking",
    "make", "many", "need", "often", "please", "rarely", "reduce", "trying", "want",
  ]);

  function expandSynonyms(query) {
    let q = " " + query.toLowerCase() + " ";
    for (const [pattern, replacement] of SYNONYM_PHRASES) {
      q = q.replace(pattern, replacement);
    }
    return q.trim();
  }

  function canonicalize(token) {
    return SYNONYM_WORDS[token] || token;
  }

  // ---------- Fuzzy / tolerant search ----------

  function levenshtein(a, b) {
    if (a === b) return 0;
    const al = a.length, bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;
    let prev = new Array(bl + 1);
    let curr = new Array(bl + 1);
    for (let j = 0; j <= bl; j++) prev[j] = j;
    for (let i = 1; i <= al; i++) {
      curr[0] = i;
      for (let j = 1; j <= bl; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      [prev, curr] = [curr, prev];
    }
    return prev[bl];
  }

  function fieldTokens(uc) {
    // Pre-split fields once per card, cached on the object.
    if (uc.__tokens) return uc.__tokens;
    const problemLabels = (uc.businessProblems || [])
      .map((id) => (state.problemsById[id] ? state.problemsById[id].label : id))
      .join(" | ")
      .toLowerCase();
    const industryLabels = (uc.industries || [])
      .map((id) => (state.industriesById[id] ? state.industriesById[id].label : id))
      .join(" | ")
      .toLowerCase();
    uc.__tokens = {
      tags: (uc.tags || []).map((t) => t.toLowerCase()),
      title: uc.title.toLowerCase(),
      oneLiner: uc.oneLiner.toLowerCase(),
      tactic: uc.personalizationTactic.toLowerCase(),
      cdp: (uc.cdpDataUsed || []).join(" | ").toLowerCase(),
      journey: uc.journey.toLowerCase(),
      trigger: (uc.customerTrigger || "").toLowerCase(),
      funnelStage: (uc.funnelStage || "").toLowerCase(),
      kpis: [uc.kpis.primary].concat(uc.kpis.secondary || []).join(" | ").toLowerCase(),
      channels: uc.channels.join(" ").toLowerCase(),
      problems: problemLabels,
      industries: industryLabels,
    };
    uc.__tokens.allText = Object.keys(uc.__tokens)
      .filter((key) => key !== "allText")
      .map((key) => Array.isArray(uc.__tokens[key]) ? uc.__tokens[key].join(" ") : uc.__tokens[key])
      .join(" ")
      .replace(/[^a-z0-9]+/g, " ");
    return uc.__tokens;
  }

  // Score a single query token against one use case. 0 = no match.
  function scoreToken(token, uc) {
    const f = fieldTokens(uc);
    let score = 0;

    if (f.tags.some((t) => t === token)) score = Math.max(score, 12);
    else if (f.tags.some((t) => t.includes(token))) score = Math.max(score, 9);

    if (f.title.includes(token)) score = Math.max(score, 10);
    if (f.channels.includes(token)) score = Math.max(score, 9);
    if (f.tactic.includes(token)) score = Math.max(score, 6);
    if (f.oneLiner.includes(token)) score = Math.max(score, 5);
    if (f.cdp.includes(token)) score = Math.max(score, 5);
    if (f.trigger.includes(token)) score = Math.max(score, 5);
    if (f.funnelStage.includes(token)) score = Math.max(score, 6);
    if (f.kpis.includes(token)) score = Math.max(score, 4);
    if (f.problems.includes(token)) score = Math.max(score, 7);
    if (f.industries.includes(token)) score = Math.max(score, 7);
    if (f.journey.includes(token)) score = Math.max(score, 2);

    // Fuzzy fallback: typo tolerance against tags + title words for tokens of length >= 4
    if (score === 0 && token.length >= 4) {
      const candidates = f.tags.concat(f.title.split(/\s+/));
      for (const c of candidates) {
        if (!c) continue;
        const dist = levenshtein(token, c);
        const tolerance = token.length <= 5 ? 1 : 2;
        if (dist <= tolerance) {
          score = Math.max(score, 4);
        }
      }
    }
    return score;
  }

  function matchesQuery(uc, query) {
    if (!query) return { match: true, score: 0 };
    const expanded = expandSynonyms(query);
    const tokens = Array.from(new Set(
      expanded
        .split(/[^a-z0-9]+/)
        .filter((token) => token && !QUERY_STOP_WORDS.has(token))
        .map(canonicalize)
    ));
    if (!tokens.length) return { match: true, score: 0 };

    let matched = 0;
    let total = 0;
    const fields = fieldTokens(uc);
    for (const tok of tokens) {
      const s = scoreToken(tok, uc);
      if (s > 0) {
        matched += 1;
        total += s;
      }
    }

    const minimumMatches = tokens.length <= 4
      ? tokens.length
      : Math.max(2, Math.ceil(tokens.length * 0.5));
    if (matched < minimumMatches) return { match: false, score: 0 };

    let phraseBonus = 0;
    for (let i = 0; i < tokens.length - 1; i++) {
      if (fields.allText.includes(tokens[i] + " " + tokens[i + 1])) phraseBonus += 6;
    }

    const coverage = matched / tokens.length;
    const averageMatchStrength = (total + phraseBonus) / tokens.length;
    return { match: true, score: coverage * 100 + averageMatchStrength };
  }

  // ---------- Filtering ----------

  // Data categories this use case needs that the client has not said they have.
  // Empty when the readiness filter is off, or when the use case has no category data
  // (so older/imported entries are never hidden by a filter they cannot answer).
  function missingData(uc) {
    const have = state.filters.dataAvailable;
    if (!have.size || !Array.isArray(uc.dataCategories)) return [];
    return uc.dataCategories.filter((category) => !have.has(category));
  }

  function passesFilters(uc, options) {
    const f = state.filters;
    if (!(options && options.skipReadiness) && missingData(uc).length) return false;
    if (f.industries.size && !(uc.industries || []).some((id) => f.industries.has(id))) return false;
    if (f.channels.size && !uc.channels.some((c) => f.channels.has(c))) return false;
    if (f.funnelStage.size && !f.funnelStage.has(uc.funnelStage)) return false;
    if (f.complexity.size && !f.complexity.has(uc.complexity)) return false;
    if (f.dataMaturity.size && !f.dataMaturity.has(uc.dataMaturity)) return false;
    if (f.businessProblems.size && !(uc.businessProblems || []).some((p) => f.businessProblems.has(p))) return false;
    if (f.quickWin && !uc.quickWin) return false;
    return true;
  }

  function getFiltered() {
    const q = state.query;
    const scored = [];
    for (const uc of state.all) {
      if (!passesFilters(uc)) continue;
      const { match, score } = matchesQuery(uc, q);
      if (!match) continue;
      scored.push({ uc, score });
    }
    if (q) scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.uc);
  }

  // ---------- Filter chip UI ----------

  const FILTER_DEFS = [
    { key: "channels", label: "Channel", values: ["web", "app", "email"] },
    {
      key: "funnelStage",
      label: "Funnel stage",
      values: ["Awareness", "Consideration", "Onboarding", "Conversion", "Retention", "Loyalty", "Reactivation"],
    },
    { key: "complexity", label: "Complexity", values: ["Low", "Medium", "High"] },
    { key: "dataMaturity", label: "CDP maturity needed", values: ["Foundational", "Intermediate", "Advanced"] },
  ];

  function buildFilterGroups() {
    els.filterGroups.innerHTML = "";

    const usedIndustryIds = new Set();
    state.all.forEach((uc) => (uc.industries || []).forEach((id) => usedIndustryIds.add(id)));
    const industryEntries = Object.values(state.industriesById).filter((industry) => usedIndustryIds.has(industry.id));
    appendTaxonomyFilterGroup("Industry", industryEntries, "industries");

    // Business problem is the primary lens — build it first, from whatever
    // problem ids are actually referenced by at least one use case.
    const usedProblemIds = new Set();
    state.all.forEach((uc) => (uc.businessProblems || []).forEach((id) => usedProblemIds.add(id)));
    const problemEntries = Object.values(state.problemsById).filter((p) => usedProblemIds.has(p.id));
    appendTaxonomyFilterGroup("Business problem", problemEntries, "businessProblems");

    // Data readiness: which kinds of CDP data does the client already have?
    const usedCategoryIds = new Set();
    state.all.forEach((uc) => (uc.dataCategories || []).forEach((id) => usedCategoryIds.add(id)));
    const categoryEntries = Object.values(state.categoriesById).filter((c) => usedCategoryIds.has(c.id));
    appendTaxonomyFilterGroup(
      "Data you already have",
      categoryEntries,
      "dataAvailable",
      "Select the data your CDP holds today. Only ideas you could run with it are shown."
    );

    FILTER_DEFS.forEach((def) => {
      const presentValues = def.values.filter((v) =>
        state.all.some((uc) => (Array.isArray(uc[def.key]) ? uc[def.key].includes(v) : uc[def.key] === v))
      );
      if (!presentValues.length) return;

      const group = document.createElement("div");
      group.className = "filter-group";
      const label = document.createElement("span");
      label.className = "filter-group-label";
      label.textContent = def.label;
      const chips = document.createElement("div");
      chips.className = "filter-chips";

      presentValues.forEach((v) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip";
        chip.textContent = v;
        chip.dataset.filterKey = def.key;
        chip.dataset.filterValue = v;
        chip.setAttribute("aria-pressed", "false");
        chips.appendChild(chip);
      });

      group.appendChild(label);
      group.appendChild(chips);
      els.filterGroups.appendChild(group);
    });

    // Quick win toggle as its own group
    const qwGroup = document.createElement("div");
    qwGroup.className = "filter-group";
    const qwLabel = document.createElement("span");
    qwLabel.className = "filter-group-label";
    qwLabel.textContent = "Effort";
    const qwChips = document.createElement("div");
    qwChips.className = "filter-chips";
    const qwChip = document.createElement("button");
    qwChip.type = "button";
    qwChip.className = "chip";
    qwChip.textContent = "⚡ Quick wins only";
    qwChip.dataset.filterKey = "quickWin";
    qwChip.dataset.filterValue = "true";
    qwChip.setAttribute("aria-pressed", "false");
    qwChips.appendChild(qwChip);
    qwGroup.appendChild(qwLabel);
    qwGroup.appendChild(qwChips);
    els.filterGroups.appendChild(qwGroup);
  }

  function appendTaxonomyFilterGroup(labelText, entries, filterKey, hint) {
    if (!entries.length) return;
    const group = document.createElement("div");
    group.className = "filter-group filter-group-wide";
    const label = document.createElement("span");
    label.className = "filter-group-label";
    label.textContent = labelText;
    const hintEl = hint ? document.createElement("span") : null;
    if (hintEl) {
      hintEl.className = "filter-group-hint";
      hintEl.textContent = hint;
    }
    const chips = document.createElement("div");
    chips.className = "filter-chips";

    entries.forEach((entry) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = entry.label;
      chip.title = entry.description || "";
      chip.dataset.filterKey = filterKey;
      chip.dataset.filterValue = entry.id;
      chip.setAttribute("aria-pressed", "false");
      chips.appendChild(chip);
    });

    group.appendChild(label);
    if (hintEl) group.appendChild(hintEl);
    group.appendChild(chips);
    els.filterGroups.appendChild(group);
  }

  // ---------- Rendering ----------

  function channelLabel(c) {
    return { web: "Web", app: "App", email: "Email" }[c] || c;
  }

  const BOOKMARK_ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">' +
    '<path d="M6 3.5h12a.5.5 0 0 1 .5.5v17l-6.5-4.2L5.5 21V4a.5.5 0 0 1 .5-.5Z"/></svg>';

  function cardHTML(uc, rationale) {
    const channels = uc.channels.map((channel) => `<span class="meta-pill">${escapeHTML(channelLabel(channel))}</span>`).join("");
    const rationaleBlock = rationale
      ? `<p class="ai-rationale">${escapeHTML(rationale)}</p>`
      : "";
    const isSaved = state.saved.includes(uc.id);
    return `
      <article class="card" tabindex="0" data-id="${uc.id}">
        <button type="button" class="save-btn${isSaved ? " saved" : ""}" data-save-id="${escapeHTML(uc.id)}"
          aria-pressed="${isSaved}" aria-label="${isSaved ? "Remove from" : "Save to"} shortlist: ${escapeHTML(uc.title)}"
          title="${isSaved ? "Saved — click to remove" : "Save to shortlist"}">${BOOKMARK_ICON}</button>
        <h3 class="card-title">${escapeHTML(uc.title)}</h3>
        <p class="card-oneliner">${escapeHTML(uc.oneLiner)}</p>
        <div class="card-customer-moment">
          <span class="card-detail-label">Customer moment</span>
          <p>${escapeHTML(uc.customerTrigger)}</p>
        </div>
        <div class="card-primary-measure">
          <span class="card-detail-label">Primary measure</span>
          <strong>${escapeHTML(uc.kpis.primary)}</strong>
        </div>
        ${rationaleBlock}
        <div class="case-footer">
          <div class="card-meta">
            ${channels}
            <span class="meta-pill complexity-${escapeHTML(uc.complexity)}">${escapeHTML(uc.complexity)} complexity</span>
          </div>
        </div>
      </article>
    `;
  }

  function render() {
    renderTray();
    scheduleURLSync();
    els.intakePanel.hidden = state.browsingStarted && !state.editingBrief;
    els.briefBar.hidden = !state.browsingStarted || state.editingBrief;
    els.searchPanel.hidden = !state.browsingStarted;
    els.resultsArea.hidden = !state.browsingStarted;
    if (state.browsingStarted) {
      renderBriefSummary();
      renderActiveFilters();
      syncFilterChips();
    }

    if (state.ai.active) {
      renderAIResults();
      return;
    }
    if (!state.browsingStarted) return;
    els.aiResultsBanner.hidden = true;

    const results = getFiltered();
    els.resultCount.textContent = `${results.length} use case${results.length === 1 ? "" : "s"}`;
    els.grid.innerHTML = results.map((uc) => cardHTML(uc)).join("");
    els.emptyState.hidden = results.length !== 0;
    renderReadinessHint();
  }

  // Card clicks are delegated once, so cards can be re-rendered freely and the
  // save button never also opens the detail panel.
  els.grid.addEventListener("click", (event) => {
    const saveBtn = event.target.closest(".save-btn");
    if (saveBtn) {
      toggleSaved(saveBtn.dataset.saveId);
      return;
    }
    const card = event.target.closest(".card");
    if (card) openDetail(card.dataset.id);
  });
  els.grid.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const card = event.target.closest(".card");
    if (card && event.target === card) openDetail(card.dataset.id);
  });

  // ---------- Detail panel ----------

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function journeyOverviewHTML(uc) {
    const story = [
      ["Customer trigger", "Starts when", uc.customerTrigger],
      ["CDP signal", "Uses", uc.cdpDataUsed[0]],
      [uc.channels.map(channelLabel).join(" / "), "Personalizes", uc.oneLiner],
    ];
    return `
      <ol class="journey-story" aria-label="Customer journey overview">
        ${story.map(([role, title, copy]) => `<li><span class="journey-story-role">${escapeHTML(role)}</span><strong>${escapeHTML(title)}</strong><span>${escapeHTML(copy)}</span></li>`).join("")}
      </ol>
      <p class="journey-story-kpi">Measured by <strong>${escapeHTML(uc.kpis.primary)}</strong></p>
      <p class="journey-story-narrative">${escapeHTML(uc.journey)}</p>
    `;
  }

  // "Data you need" pills. When the readiness filter is on, flag what the client is missing.
  function dataNeededHTML(uc) {
    const pills = dataPillsHTML(uc);
    return pills ? `<div class="detail-section"><h3>Data you need</h3><div class="detail-badges">${pills}</div></div>` : "";
  }

  function dataPillsHTML(uc) {
    const categories = (uc.dataCategories || []).map((id) => state.categoriesById[id]).filter(Boolean);
    if (!categories.length) return "";
    const missing = new Set(missingData(uc));
    const checking = state.filters.dataAvailable.size > 0;
    const pills = categories.map((category) => {
      const isMissing = missing.has(category.id);
      const status = checking ? (isMissing ? " — you don’t have this yet" : " — you have this") : "";
      return `<span class="data-pill${checking ? (isMissing ? " missing" : " have") : ""}" title="${escapeHTML(category.description || "")}">` +
        `${checking ? (isMissing ? "✕ " : "✓ ") : ""}${escapeHTML(category.label)}<span class="visually-hidden">${escapeHTML(status)}</span></span>`;
    }).join("");
    return pills;
  }

  function detailHTML(uc) {
    const channels = uc.channels.map((c) => `<span class="meta-pill">${escapeHTML(channelLabel(c))}</span>`).join("");
    const cdpList = uc.cdpDataUsed.map((d) => `<li>${escapeHTML(d)}</li>`).join("");
    const toolsList = uc.toolsNeeded.map((t) => `<li>${escapeHTML(t)}</li>`).join("");
    const secondaryKpis = uc.kpis.secondary.map((k) => `<span class="kpi-secondary">${escapeHTML(k)}</span>`).join("");
    const source = uc.source && typeof uc.source === "object" ? uc.source : null;
    let sourceSection = "";
    if (source && typeof source.url === "string" && source.url.trim()) {
      const sourceUrl = source.url.trim();
      const sourceTitle = typeof source.title === "string" && source.title.trim()
        ? source.title.trim()
        : sourceUrl;
      let sourceLink = escapeHTML(sourceTitle);
      try {
        const parsedUrl = new URL(sourceUrl);
        if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
          sourceLink = `<a href="${escapeHTML(parsedUrl.href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(sourceTitle)}</a>`;
        }
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
      }
      sourceSection = `
        <div class="detail-section">
          <h3>Source</h3>
          <p>${sourceLink}<span class="detail-source-url">${escapeHTML(sourceUrl)}</span></p>
        </div>
      `;
    }
    const problemPills = (uc.businessProblems || [])
      .map((id) => state.problemsById[id])
      .filter(Boolean)
      .map((p) => `<span class="problem-pill" title="${escapeHTML(p.description || "")}">${escapeHTML(p.label)}</span>`)
      .join("");
    const industryPills = (uc.industries || [])
      .map((id) => state.industriesById[id])
      .filter(Boolean)
      .map((industry) => `<span class="industry-pill" title="${escapeHTML(industry.description || "")}">${escapeHTML(industry.label)}</span>`)
      .join("");

    return `
      <button class="detail-close" id="detailCloseBtn" aria-label="Close">×</button>
      <div class="detail-header">
        <p class="detail-eyebrow">${escapeHTML(uc.personalizationTactic)}</p>
        <h2 class="detail-title">${escapeHTML(uc.title)}</h2>
        <p class="detail-oneliner">${escapeHTML(uc.oneLiner)}</p>

        <div class="detail-badges">
          ${channels}
          <span class="meta-pill">${escapeHTML(uc.funnelStage)}</span>
          <span class="meta-pill complexity-${escapeHTML(uc.complexity)}">${escapeHTML(uc.complexity)} complexity</span>
          <span class="meta-pill">${escapeHTML(uc.dataMaturity)} data</span>
          ${uc.quickWin ? '<span class="quickwin-badge">Quick win</span>' : ""}
        </div>

        <div class="detail-actions">
          <button type="button" class="action-btn" data-detail-save="${escapeHTML(uc.id)}"></button>
          <button type="button" class="action-btn" data-detail-copy="${escapeHTML(uc.id)}">Copy link to this idea</button>
        </div>
      </div>

      ${sourceSection}

      <div class="detail-section">
        <h3>Customer journey</h3>
        ${journeyOverviewHTML(uc)}
      </div>

      <div class="detail-section">
        <h3>Example experience</h3>
        <div class="before-after">
          <div class="ba-box before"><span class="ba-label">Before</span>${uc.exampleBefore}</div>
          <div class="ba-box after"><span class="ba-label">After</span>${uc.exampleAfter}</div>
        </div>
      </div>

      ${dataNeededHTML(uc)}

      <div class="detail-section">
        <h3>CDP data used</h3>
        <ul>${cdpList}</ul>
      </div>

      <div class="detail-section">
        <h3>Success measures</h3>
        <div class="kpi-row">
          <span class="kpi-primary">${uc.kpis.primary}</span>
          ${secondaryKpis}
        </div>
      </div>

      <div class="detail-section">
        <h3>Build requirements</h3>
        <ul>${toolsList}</ul>
      </div>

      ${problemPills ? `<div class="detail-section"><h3>Solves for</h3><div class="detail-badges">${problemPills}</div></div>` : ""}
      ${industryPills ? `<div class="detail-section"><h3>Relevant industries</h3><div class="detail-badges">${industryPills}</div></div>` : ""}
    `;
  }

  function openDetail(id, fromHistory = false) {
    const uc = state.all.find((u) => u.id === id);
    if (!uc) return;
    if (!fromHistory && history.state?.useCaseDetail !== id) {
      const currentState = history.state && typeof history.state === "object" ? history.state : {};
      history.pushState({ ...currentState, useCaseDetail: id }, "", window.location.href);
    }
    state.detailId = id;
    els.detailContent.innerHTML = detailHTML(uc);
    els.overlay.hidden = false;
    els.detailPanel.hidden = false;
    els.detailPanel.setAttribute("aria-hidden", "false");
    document.getElementById("detailCloseBtn").addEventListener("click", closeDetail);
    document.body.style.overflow = "hidden";
    syncSavedUI();
    syncURL();
  }

  els.detailContent.addEventListener("click", (event) => {
    const saveBtn = event.target.closest("[data-detail-save]");
    if (saveBtn) {
      toggleSaved(saveBtn.dataset.detailSave);
      return;
    }
    const copyBtn = event.target.closest("[data-detail-copy]");
    if (copyBtn) {
      copyText(buildShareURL({ caseId: copyBtn.dataset.detailCopy, bare: true })).then((ok) =>
        showToast(ok ? "Link to this idea copied" : "Couldn’t copy — copy the address bar instead")
      );
    }
  });

  function closeDetail() {
    if (history.state?.useCaseDetail) {
      history.back();
      return;
    }
    hideDetail();
  }

  function hideDetail() {
    state.detailId = null;
    els.overlay.hidden = true;
    els.detailPanel.hidden = true;
    els.detailPanel.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    syncURL();
  }

  window.addEventListener("popstate", () => {
    const detailId = history.state?.useCaseDetail;
    if (detailId) {
      openDetail(detailId, true);
    } else {
      hideDetail();
    }
  });

  els.overlay.addEventListener("click", closeDetail);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetail();
  });

  // ---------- Keyword search wiring ----------

  let debounceTimer = null;
  els.keywordSearchInput.addEventListener("input", (e) => {
    state.query = e.target.value;
    els.clearKeywordSearch.classList.toggle("visible", !!state.query);
    if (state.ai.active) {
      state.ai.active = false;
      state.ai.matches = [];
    }
    setAIStatus("", false);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, 80);
  });

  els.clearKeywordSearch.addEventListener("click", () => {
    els.keywordSearchInput.value = "";
    state.query = "";
    state.ai.active = false;
    state.ai.matches = [];
    state.ai.problem = "";
    els.clearKeywordSearch.classList.remove("visible");
    setAIStatus("", false);
    render();
    els.keywordSearchInput.focus();
  });

  // Try to point "View on GitHub" at the actual repo if it's been customized.
  const repoLink = document.getElementById("repoLink");
  if (window.REPO_URL) repoLink.href = window.REPO_URL;

  // ---------- AI-powered "describe your problem" search ----------
  // Calls a Netlify serverless function (netlify/functions/diagnose.js) that
  // asks an LLM to match the freeform problem text against the whole
  // library. This is the one feature that needs the site deployed with the
  // function configured — see SETUP.md. On any failure (function not
  // deployed yet, no API key configured, network error) this fails
  // gracefully with a message rather than breaking the page.

  function renderAIResults() {
    els.aiResultsBanner.hidden = false;
    const matches = state.ai.matches.filter((match) => {
      const useCase = state.all.find((item) => item.id === match.id);
      return useCase && passesFilters(useCase);
    });
    els.aiResultsText.textContent = matches.length
      ? `AI matched these ideas to “${state.ai.problem}”.`
      : `No strong matches found for: "${state.ai.problem}"`;

    const cards = matches
      .map((m) => {
        const uc = state.all.find((u) => u.id === m.id);
        return uc ? cardHTML(uc, m.rationale) : "";
      })
      .join("");

    els.grid.innerHTML = cards;
    els.emptyState.hidden = matches.length !== 0;
    els.resultCount.textContent = `${matches.length} match${matches.length === 1 ? "" : "es"}`;
    els.readinessHint.hidden = true;
  }

  function setAIStatus(message, isError) {
    els.aiStatus.hidden = !message;
    els.aiStatus.textContent = message || "";
    els.aiStatus.classList.toggle("error", !!isError);
  }

  async function submitAIQuery() {
    const problem = els.aiProblemInput.value.trim();
    if (!problem) {
      setAIStatus("Describe your situation above first.", true);
      return;
    }

    els.aiSubmitBtn.disabled = true;
    els.aiSubmitBtn.textContent = "Finding AI matches…";
    els.aiProblemInput.disabled = true;
    setAIStatus("Matching your situation against the library…", false);
    state.ai.active = false;
    state.ai.matches = [];
    render();

    try {
      const res = await fetch("/.netlify/functions/diagnose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ problem, industries: Array.from(state.filters.industries) }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      const data = await res.json();
      state.ai.active = true;
      state.ai.problem = problem;
      state.ai.matches = Array.isArray(data.matches) ? data.matches : [];
      setAIStatus("", false);
      render();
    } catch (err) {
      state.ai.active = false;
      state.ai.matches = [];
      setAIStatus(
        "AI matching isn’t available right now (" +
          err.message +
          "). Use the keyword search icon above the results to filter locally, or remove filters to broaden results.",
        true
      );
      render();
    } finally {
      els.aiSubmitBtn.disabled = false;
      els.aiSubmitBtn.textContent = "Use AI to find matches";
      els.aiProblemInput.disabled = false;
    }
  }

  els.aiProblemInput.addEventListener("input", () => {
    if (!state.ai.active) return;
    state.ai.active = false;
    state.ai.matches = [];
    state.ai.problem = "";
    render();
  });

  function clearAIResults() {
    state.ai.active = false;
    state.ai.matches = [];
    state.ai.problem = "";
    setAIStatus("", false);
    render();
  }

  function populateSelect(select, entries) {
    entries.forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entry.label;
      select.appendChild(option);
    });
  }

  function populateIntakeOptions() {
    const usedProblemIds = new Set();
    const usedIndustryIds = new Set();
    state.all.forEach((uc) => {
      (uc.businessProblems || []).forEach((id) => usedProblemIds.add(id));
      (uc.industries || []).forEach((id) => usedIndustryIds.add(id));
    });

    populateSelect(
      els.intakeProblem,
      Object.values(state.problemsById).filter((problem) => usedProblemIds.has(problem.id))
    );
    populateSelect(
      els.intakeIndustry,
      Object.values(state.industriesById).filter((industry) => usedIndustryIds.has(industry.id))
    );
    populateSelect(
      els.intakeFunnelStage,
      JOURNEY_STAGES.map((stage) => ({ id: stage, label: stage }))
    );
  }

  const INDUSTRY_ICONS = {
    "retail-consumer-goods": '<path d="M5 9h14l-1 11H6L5 9Z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/><path d="M9 13h6"/>',
    "financial-services": '<path d="m3 9 9-5 9 5"/><path d="M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18M4 9h16"/>',
    "telecom-media-technology": '<path d="M12 19h.01"/><path d="M8.5 15.5a5 5 0 0 1 7 0"/><path d="M5.5 12.5a9 9 0 0 1 13 0"/><path d="M2.5 9.5a13 13 0 0 1 19 0"/>',
    "travel-hospitality": '<path d="m3 11 18-7-7 18-3-8-8-3Z"/><path d="m11 14 5-5"/>',
    "automotive-manufacturing": '<path d="M4 16h16l-1-5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2l-1 5Z"/><path d="M4 16v3h3v-3m10 0v3h3v-3M7 12h10M7 16h.01M17 16h.01"/>',
    "healthcare-public-sector-utilities": '<path d="M12 21s-8-4.5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.5-8 11-8 11Z"/><path d="M9 12h6m-3-3v6"/>',
  };

  function buildIndustryCards() {
    const counts = new Map();
    state.all.forEach((useCase) => {
      (useCase.industries || []).forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
    });

    const industries = Object.values(state.industriesById).filter((industry) => counts.has(industry.id));
    els.industryCards.innerHTML = industries.map((industry) => {
      const count = counts.get(industry.id);
      const icon = INDUSTRY_ICONS[industry.id] || '<circle cx="12" cy="12" r="8"/><path d="M12 8v8m-4-4h8"/>';
      return `
        <a class="industry-card" href="?industry=${encodeURIComponent(industry.id)}#resultsArea"
          aria-label="Explore ${escapeHTML(industry.label)}: ${count} use case${count === 1 ? "" : "s"}">
          <span class="industry-art" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
              stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
          </span>
          <span class="industry-card-copy">
            <strong>${escapeHTML(industry.label)}</strong>
            <span>${escapeHTML(industry.description || "")}</span>
          </span>
          <span class="industry-card-footer">
            <span>${count} use case${count === 1 ? "" : "s"}</span><span class="industry-arrow" aria-hidden="true">↗</span>
          </span>
        </a>
      `;
    }).join("");
  }

  function syncFilterChips() {
    els.filterGroups.querySelectorAll(".chip[data-filter-key]").forEach((chip) => {
      const { filterKey, filterValue } = chip.dataset;
      const active = filterKey === "quickWin"
        ? state.filters.quickWin
        : state.filters[filterKey].has(filterValue);
      chip.classList.toggle("active", active);
      chip.setAttribute("aria-pressed", String(active));
    });
  }

  function startBrowsing(problemId, industryId, quickWinsOnly, funnelStage) {
    Object.values(state.filters).forEach((filter) => {
      if (filter instanceof Set) filter.clear();
    });
    state.filters.quickWin = quickWinsOnly;
    if (problemId) state.filters.businessProblems.add(problemId);
    if (industryId) state.filters.industries.add(industryId);
    if (funnelStage) state.filters.funnelStage.add(funnelStage);

    state.query = "";
    els.keywordSearchInput.value = "";
    els.aiProblemInput.value = "";
    els.clearKeywordSearch.classList.remove("visible");
    state.ai.active = false;
    state.ai.matches = [];
    state.ai.problem = "";
    setAIStatus("", false);
    state.browsingStarted = true;
    state.editingBrief = false;
    syncFilterChips();
    render();
    scrollToSection(els.resultsArea);
  }

  function scrollToSection(element) {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    element.scrollIntoView({ behavior, block: "start" });
  }

  els.intakeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const problemId = els.intakeProblem.value;
    const industryId = els.intakeIndustry.value;
    const funnelStage = els.intakeFunnelStage.value;
    if (state.browsingStarted) updateBrief(problemId, industryId, funnelStage);
    else startBrowsing(problemId, industryId, false, funnelStage);
  });

  els.browseAllBtn.addEventListener("click", () => {
    els.intakeProblem.value = "";
    els.intakeIndustry.value = "";
    els.intakeFunnelStage.value = "";
    startBrowsing("", "", false, "");
  });

  els.missionShortcuts.forEach((shortcut) => {
    shortcut.addEventListener("click", () => {
      const mission = shortcut.dataset.mission;
      const problemId = mission === "quickWin" ? "" : mission;
      const quickWinsOnly = mission === "quickWin";
      els.intakeProblem.value = problemId;
      els.intakeIndustry.value = "";
      els.intakeFunnelStage.value = "";
      startBrowsing(problemId, "", quickWinsOnly, "");
    });
  });

  els.editBriefBtn.addEventListener("click", () => {
    els.intakeProblem.value = state.filters.businessProblems.values().next().value || "";
    els.intakeIndustry.value = state.filters.industries.values().next().value || "";
    els.intakeFunnelStage.value = state.filters.funnelStage.values().next().value || "";
    state.editingBrief = true;
    if (els.refinePanel) els.refinePanel.open = false;
    render();
    scrollToSection(els.intakePanel);
    els.intakeProblem.focus({ preventScroll: true });
  });

  function updateBrief(problemId, industryId, funnelStage) {
    const currentProblem = state.filters.businessProblems.values().next().value || "";
    if (problemId !== currentProblem) {
      state.filters.businessProblems.clear();
      if (problemId) state.filters.businessProblems.add(problemId);
    }

    const currentIndustry = state.filters.industries.values().next().value || "";
    if (industryId !== currentIndustry) {
      state.filters.industries.clear();
      if (industryId) state.filters.industries.add(industryId);
    }

    const currentStage = state.filters.funnelStage.values().next().value || "";
    if (funnelStage !== currentStage) {
      state.filters.funnelStage.clear();
      if (funnelStage) state.filters.funnelStage.add(funnelStage);
    }

    state.editingBrief = false;
    render();
    scrollToSection(els.resultsArea);
  }

  function renderBriefSummary() {
    const parts = [];
    state.filters.businessProblems.forEach((id) => {
      if (state.problemsById[id]) parts.push(state.problemsById[id].label);
    });
    state.filters.industries.forEach((id) => {
      if (state.industriesById[id]) parts.push(state.industriesById[id].label);
    });
    state.filters.funnelStage.forEach((stage) => parts.push(stage));
    if (state.filters.dataAvailable.size) {
      const n = state.filters.dataAvailable.size;
      parts.push(`${n} data type${n === 1 ? "" : "s"} available`);
    }
    if (state.filters.quickWin) parts.push("Quick wins");
    els.briefSummary.textContent = parts.length ? parts.join(" · ") : "Exploring the whole library";
    els.editBriefBtn.textContent = state.editingBrief ? "Update shortlist" : "Edit brief";
    document.querySelector(".intake-submit").textContent = state.editingBrief ? "Update shortlist" : "Build my shortlist";
  }

  function getActiveFilters() {
    const active = [];
    const appendSet = (key, labels) => {
      state.filters[key].forEach((value) => {
        active.push({ key, value, label: labels[value] || value });
      });
    };
    appendSet("industries", Object.fromEntries(
      Object.values(state.industriesById).map((industry) => [industry.id, industry.label])
    ));
    appendSet("businessProblems", Object.fromEntries(
      Object.values(state.problemsById).map((problem) => [problem.id, problem.label])
    ));
    FILTER_DEFS.forEach((definition) => {
      if (definition.key === "channels") {
        appendSet("channels", { web: "Web", app: "App", email: "Email" });
      } else {
        appendSet("".concat(definition.key), {});
      }
    });
    appendSet("dataAvailable", Object.fromEntries(
      Object.values(state.categoriesById).map((category) => [category.id, "Has: " + category.label])
    ));
    if (state.filters.quickWin) active.push({ key: "quickWin", value: "true", label: "Quick wins" });
    return active;
  }

  function renderActiveFilters() {
    const active = getActiveFilters();
    els.activeFilters.hidden = active.length === 0;
    els.activeFilters.innerHTML = active.map((filter) =>
      `<button type="button" class="active-filter" data-filter-key="${escapeHTML(filter.key)}" data-filter-value="${escapeHTML(filter.value)}" aria-label="Remove ${escapeHTML(filter.label)} filter">${escapeHTML(filter.label)} <span aria-hidden="true">×</span></button>`
    ).join("");
    els.activeFilters.querySelectorAll(".active-filter").forEach((chip) => {
      chip.addEventListener("click", () => {
        const { filterKey, filterValue } = chip.dataset;
        if (filterKey === "quickWin") state.filters.quickWin = false;
        else state.filters[filterKey].delete(filterValue);
        render();
      });
    });
  }

  els.filterGroups.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip[data-filter-key]");
    if (!chip) return;
    const { filterKey, filterValue } = chip.dataset;
    if (filterKey === "quickWin") {
      state.filters.quickWin = !state.filters.quickWin;
    } else {
      const selected = state.filters[filterKey];
      if (selected.has(filterValue)) selected.delete(filterValue);
      else selected.add(filterValue);
    }
    render();
  });

  // ---------- Data readiness: what would unlock more ideas? ----------

  function renderReadinessHint() {
    const hide = () => {
      els.readinessHint.hidden = true;
      els.readinessHint.innerHTML = "";
    };
    if (!state.filters.dataAvailable.size) return hide();

    // Count ideas that are blocked by exactly one missing data type, ignoring only the readiness filter.
    const unlocks = {};
    state.all.forEach((uc) => {
      if (!passesFilters(uc, { skipReadiness: true })) return;
      if (state.query && !matchesQuery(uc, state.query).match) return;
      const missing = missingData(uc);
      if (missing.length === 1) unlocks[missing[0]] = (unlocks[missing[0]] || 0) + 1;
    });
    const top = Object.entries(unlocks)
      .filter(([id]) => state.categoriesById[id])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (!top.length) return hide();

    els.readinessHint.hidden = false;
    els.readinessHint.innerHTML =
      '<span class="readiness-hint-label">Just one data type away</span>' +
      top.map(([id, count]) =>
        `<button type="button" class="readiness-unlock" data-unlock="${escapeHTML(id)}">` +
        `Add ${escapeHTML(state.categoriesById[id].label)} <strong>+${count} idea${count === 1 ? "" : "s"}</strong></button>`
      ).join("");
  }

  els.readinessHint.addEventListener("click", (event) => {
    const button = event.target.closest("[data-unlock]");
    if (!button) return;
    state.filters.dataAvailable.add(button.dataset.unlock);
    render();
  });

  // ---------- Saved shortlist ----------

  const SAVED_STORAGE_KEY = "plc.saved.v1";
  const MAX_SAVED_FROM_URL = 50;

  function findCase(id) {
    return state.all.find((uc) => uc.id === id);
  }

  function loadSavedFromStorage() {
    try {
      const stored = JSON.parse(window.localStorage.getItem(SAVED_STORAGE_KEY) || "[]");
      return Array.isArray(stored) ? stored.filter((id) => typeof id === "string" && findCase(id)) : [];
    } catch (error) {
      return [];
    }
  }

  function persistSaved() {
    try {
      window.localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(state.saved));
    } catch (error) {
      /* storage can be blocked (private mode); the shortlist still works for this visit and via links */
    }
  }

  function toggleSaved(id) {
    if (!findCase(id)) return;
    const index = state.saved.indexOf(id);
    if (index >= 0) state.saved.splice(index, 1);
    else state.saved.push(id);
    persistSaved();
    syncSavedUI();
    scheduleURLSync();
    if (!state.saved.length && els.modal.open) els.modal.close();
  }

  function syncSavedUI() {
    els.grid.querySelectorAll(".save-btn").forEach((button) => {
      const id = button.dataset.saveId;
      const uc = findCase(id);
      const on = state.saved.includes(id);
      button.classList.toggle("saved", on);
      button.setAttribute("aria-pressed", String(on));
      button.setAttribute("aria-label", `${on ? "Remove from" : "Save to"} shortlist: ${uc ? uc.title : ""}`);
      button.title = on ? "Saved — click to remove" : "Save to shortlist";
    });
    const detailButton = els.detailContent.querySelector("[data-detail-save]");
    if (detailButton) {
      const on = state.saved.includes(detailButton.dataset.detailSave);
      detailButton.textContent = on ? "★ Saved to shortlist" : "☆ Save to shortlist";
      detailButton.setAttribute("aria-pressed", String(on));
      detailButton.classList.toggle("saved", on);
    }
    renderTray();
    if (els.modal.open) renderShortlistModal();
  }

  function renderTray() {
    const count = state.saved.length;
    els.tray.hidden = count === 0;
    document.body.classList.toggle("has-tray", count > 0);
    els.trayCount.textContent = `${count} idea${count === 1 ? "" : "s"} saved`;
  }

  function savedCases() {
    return state.saved.map(findCase).filter(Boolean);
  }

  // ---------- Compare & shortlist dialog ----------

  function labelsFor(ids, byId) {
    return (ids || []).map((id) => (byId[id] ? byId[id].label : id));
  }

  function listHTML(items) {
    return items && items.length
      ? `<ul class="compare-list">${items.map((item) => `<li>${escapeHTML(item)}</li>`).join("")}</ul>`
      : "—";
  }

  const COMPARE_ROWS = [
    ["What it does", (uc) => escapeHTML(uc.oneLiner)],
    ["Customer moment", (uc) => escapeHTML(uc.customerTrigger)],
    ["Journey stage", (uc) => escapeHTML(uc.funnelStage)],
    ["Channels", (uc) => uc.channels.map((c) => `<span class="meta-pill">${escapeHTML(channelLabel(c))}</span>`).join(" ")],
    ["Effort", (uc) =>
      `<span class="meta-pill complexity-${escapeHTML(uc.complexity)}">${escapeHTML(uc.complexity)} complexity</span>` +
      (uc.quickWin ? ' <span class="quickwin-badge">Quick win</span>' : "")],
    ["CDP maturity needed", (uc) => escapeHTML(uc.dataMaturity)],
    ["Data you need", (uc) => dataPillsHTML(uc) || "—"],
    ["CDP data points", (uc) => listHTML(uc.cdpDataUsed)],
    ["Primary measure", (uc) => `<strong>${escapeHTML(uc.kpis.primary)}</strong>`],
    ["Other measures", (uc) => listHTML(uc.kpis.secondary)],
    ["Build requirements", (uc) => listHTML(uc.toolsNeeded)],
    ["Solves for", (uc) => listHTML(labelsFor(uc.businessProblems, state.problemsById))],
  ];

  function renderShortlistModal() {
    const cases = savedCases();
    els.modalCount.textContent = `${cases.length} idea${cases.length === 1 ? "" : "s"} · side-by-side`;
    if (!cases.length) {
      els.modalBody.innerHTML = '<p class="empty-state">Nothing saved yet. Use the bookmark on any idea to add it here.</p>';
      return;
    }
    const head = cases.map((uc) =>
      `<th scope="col"><button type="button" class="compare-title" data-open="${escapeHTML(uc.id)}">${escapeHTML(uc.title)}</button>` +
      `<button type="button" class="compare-remove" data-remove="${escapeHTML(uc.id)}" aria-label="Remove ${escapeHTML(uc.title)} from shortlist">Remove</button></th>`
    ).join("");
    const body = COMPARE_ROWS.map(([label, cell]) =>
      `<tr><th scope="row">${escapeHTML(label)}</th>${cases.map((uc) => `<td>${cell(uc)}</td>`).join("")}</tr>`
    ).join("");
    els.modalBody.innerHTML =
      '<div class="compare-scroll" tabindex="0" role="region" aria-label="Comparison table, scrolls sideways on small screens">' +
      `<table class="compare-table"><thead><tr><th scope="col" class="compare-corner"><span class="visually-hidden">Attribute</span></th>${head}</tr></thead>` +
      `<tbody>${body}</tbody></table></div>`;
  }

  function openShortlistModal() {
    if (!state.saved.length) return;
    renderShortlistModal();
    if (!els.modal.open) els.modal.showModal();
  }

  els.trayReview.addEventListener("click", openShortlistModal);
  els.modalClose.addEventListener("click", () => els.modal.close());
  els.modal.addEventListener("click", (event) => {
    if (event.target === els.modal) els.modal.close(); // click on the backdrop
    const openBtn = event.target.closest("[data-open]");
    if (openBtn) {
      els.modal.close();
      openDetail(openBtn.dataset.open);
      return;
    }
    const removeBtn = event.target.closest("[data-remove]");
    if (removeBtn) {
      toggleSaved(removeBtn.dataset.remove);
      return;
    }
    const exportBtn = event.target.closest("[data-export]");
    if (exportBtn) runExport(exportBtn.dataset.export);
  });

  let clearTimer = null;
  function resetClearButton() {
    clearTimeout(clearTimer);
    els.trayClear.textContent = "Clear";
    els.trayClear.dataset.armed = "";
  }
  els.trayClear.addEventListener("click", () => {
    if (!els.trayClear.dataset.armed) {
      // Two-step so a stray click can't wipe the list.
      els.trayClear.dataset.armed = "1";
      els.trayClear.textContent = "Click again to clear";
      clearTimer = setTimeout(resetClearButton, 3000);
      return;
    }
    resetClearButton();
    state.saved = [];
    persistSaved();
    syncSavedUI();
    scheduleURLSync();
  });

  // ---------- Export ----------

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function ideaLink(uc) {
    return buildShareURL({ caseId: uc.id, bare: true });
  }

  function sourceUrlOf(uc) {
    return uc.source && typeof uc.source.url === "string" ? uc.source.url.trim() : "";
  }

  // Neutralize spreadsheet formulas (=, +, -, @) so opening the CSV in Excel can't run injected content.
  function csvCell(value) {
    let text = String(value == null ? "" : value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function downloadFile(filename, text, mimeType) {
    const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCSV(cases) {
    const header = [
      "Title", "What it does", "Journey stage", "Channels", "Complexity", "Quick win", "CDP maturity needed",
      "Data you need", "CDP data points", "Customer moment", "Primary measure", "Other measures",
      "Build requirements", "Solves for", "Industries", "Source", "Link",
    ];
    const rows = cases.map((uc) => [
      uc.title, uc.oneLiner, uc.funnelStage, uc.channels.map(channelLabel).join("; "), uc.complexity,
      uc.quickWin ? "Yes" : "No", uc.dataMaturity, labelsFor(uc.dataCategories, state.categoriesById).join("; "),
      uc.cdpDataUsed.join("; "), uc.customerTrigger, uc.kpis.primary, (uc.kpis.secondary || []).join("; "),
      uc.toolsNeeded.join("; "), labelsFor(uc.businessProblems, state.problemsById).join("; "),
      labelsFor(uc.industries, state.industriesById).join("; "), sourceUrlOf(uc), ideaLink(uc),
    ]);
    // BOM so Excel reads the file as UTF-8.
    const csv = "﻿" + [header].concat(rows).map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadFile(`personalization-shortlist-${today()}.csv`, csv, "text/csv;charset=utf-8");
  }

  function shortlistAsText(cases) {
    const lines = [`# Personalization shortlist (${cases.length} idea${cases.length === 1 ? "" : "s"})`, `Prepared ${today()}`, ""];
    cases.forEach((uc, index) => {
      lines.push(`## ${index + 1}. ${uc.title}`, uc.oneLiner, "");
      lines.push(`- Customer moment: ${uc.customerTrigger}`);
      lines.push(`- Journey stage: ${uc.funnelStage} · Channels: ${uc.channels.map(channelLabel).join(", ")}`);
      lines.push(`- Effort: ${uc.complexity} complexity${uc.quickWin ? " (quick win)" : ""} · CDP maturity needed: ${uc.dataMaturity}`);
      const data = labelsFor(uc.dataCategories, state.categoriesById);
      if (data.length) lines.push(`- Data you need: ${data.join(", ")}`);
      lines.push(`- Primary measure: ${uc.kpis.primary}`);
      lines.push(`- More: ${ideaLink(uc)}`, "");
    });
    return lines.join("\n");
  }

  function renderPrintSheet(cases) {
    const context = state.browsingStarted ? els.briefSummary.textContent : "";
    const summaryRows = cases.map((uc) =>
      `<tr><td>${escapeHTML(uc.title)}</td><td>${escapeHTML(uc.funnelStage)}</td><td>${escapeHTML(uc.channels.map(channelLabel).join(", "))}</td>` +
      `<td>${escapeHTML(uc.complexity)}${uc.quickWin ? " · quick win" : ""}</td><td>${escapeHTML(uc.dataMaturity)}</td></tr>`
    ).join("");
    const details = cases.map((uc, index) => {
      const data = labelsFor(uc.dataCategories, state.categoriesById).join(", ");
      return `<section class="print-case">
        <h2>${index + 1}. ${escapeHTML(uc.title)}</h2>
        <p>${escapeHTML(uc.oneLiner)}</p>
        <dl>
          <dt>Customer moment</dt><dd>${escapeHTML(uc.customerTrigger)}</dd>
          <dt>Journey</dt><dd>${escapeHTML(uc.journey)}</dd>
          ${data ? `<dt>Data you need</dt><dd>${escapeHTML(data)}</dd>` : ""}
          <dt>CDP data points</dt><dd>${escapeHTML(uc.cdpDataUsed.join("; "))}</dd>
          <dt>Primary measure</dt><dd>${escapeHTML(uc.kpis.primary)}</dd>
          <dt>Build requirements</dt><dd>${escapeHTML(uc.toolsNeeded.join("; "))}</dd>
        </dl>
      </section>`;
    }).join("");
    els.printSheet.innerHTML =
      `<h1>Personalization shortlist</h1>
       <p class="print-meta">${cases.length} idea${cases.length === 1 ? "" : "s"} · prepared ${escapeHTML(today())}${context ? " · " + escapeHTML(context) : ""}</p>
       <table class="print-summary"><thead><tr><th>Idea</th><th>Journey stage</th><th>Channels</th><th>Effort</th><th>CDP maturity</th></tr></thead><tbody>${summaryRows}</tbody></table>
       ${details}`;
  }

  function runExport(kind) {
    const cases = savedCases();
    if (kind === "link") {
      copyText(buildShareURL()).then((ok) => showToast(ok ? "Shortlist link copied" : "Couldn’t copy — copy the address bar instead"));
      return;
    }
    if (!cases.length) return;
    if (kind === "csv") {
      exportCSV(cases);
      showToast("CSV downloaded");
    } else if (kind === "text") {
      copyText(shortlistAsText(cases)).then((ok) => showToast(ok ? "Summary copied" : "Couldn’t copy the summary"));
    } else if (kind === "print") {
      renderPrintSheet(cases);
      window.print();
    }
  }

  // ---------- Shareable links ----------
  // The URL is a readable snapshot of the current shortlist: filters, keyword, saved ideas, and an
  // open idea. Nothing is sent anywhere — it is only text the visitor can copy.

  const URL_FILTER_PARAMS = [
    ["industries", "industry"],
    ["businessProblems", "problem"],
    ["channels", "channel"],
    ["funnelStage", "stage"],
    ["complexity", "complexity"],
    ["dataMaturity", "maturity"],
    ["dataAvailable", "data"],
  ];

  function buildShareURL(options) {
    const opts = options || {};
    const params = new URLSearchParams();
    if (!opts.bare) {
      let hasFilter = false;
      URL_FILTER_PARAMS.forEach(([key, param]) => {
        if (!state.filters[key].size) return;
        params.set(param, Array.from(state.filters[key]).join(","));
        hasFilter = true;
      });
      if (state.filters.quickWin) {
        params.set("quick", "1");
        hasFilter = true;
      }
      if (state.query) {
        params.set("q", state.query);
        hasFilter = true;
      }
      if (state.browsingStarted && !hasFilter) params.set("view", "all");
      if (state.saved.length) params.set("saved", state.saved.join(","));
    }
    if (opts.caseId) params.set("case", opts.caseId);
    const base = window.location.href.split(/[?#]/)[0];
    const query = params.toString().replace(/%2C/g, ",");
    return query ? base + "?" + query : base;
  }

  function restoreFromURL() {
    const params = new URLSearchParams(window.location.search);
    const list = (name) => (params.get(name) || "").split(",").map((value) => value.trim()).filter(Boolean);
    // Only accept values that exist in the library, so a hand-edited link can't inject junk.
    const isKnown = {
      industries: (v) => !!state.industriesById[v],
      businessProblems: (v) => !!state.problemsById[v],
      channels: (v) => ["web", "app", "email"].includes(v),
      funnelStage: (v) => JOURNEY_STAGES.includes(v),
      complexity: (v) => ["Low", "Medium", "High"].includes(v),
      dataMaturity: (v) => ["Foundational", "Intermediate", "Advanced"].includes(v),
      dataAvailable: (v) => !!state.categoriesById[v],
    };

    let browse = false;
    URL_FILTER_PARAMS.forEach(([key, param]) => {
      list(param).filter(isKnown[key]).forEach((value) => {
        state.filters[key].add(value);
        browse = true;
      });
    });
    if (params.get("quick") === "1") {
      state.filters.quickWin = true;
      browse = true;
    }
    const query = (params.get("q") || "").trim().slice(0, 200);
    if (query) {
      state.query = query;
      els.keywordSearchInput.value = query;
      els.clearKeywordSearch.classList.add("visible");
      browse = true;
    }
    if (params.get("view") === "all") browse = true;

    const fromURL = list("saved").filter((id) => findCase(id)).slice(0, MAX_SAVED_FROM_URL);
    state.saved = Array.from(new Set(fromURL.length ? fromURL : loadSavedFromStorage()));

    if (browse) state.browsingStarted = true;
    const caseId = params.get("case");
    return { browse, caseId: caseId && findCase(caseId) ? caseId : null };
  }

  let urlTimer = null;
  function scheduleURLSync() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(syncURL, 250); // browsers rate-limit history.replaceState, so don't call it per keystroke
  }

  function syncURL() {
    clearTimeout(urlTimer);
    try {
      const target = buildShareURL({ caseId: state.detailId });
      if (target !== window.location.href) window.history.replaceState(window.history.state, "", target);
    } catch (error) {
      /* file:// and some sandboxes refuse URL changes; the Copy link button still works */
    }
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      /* fall through to the legacy path */
    }
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch (error) {
      return false;
    }
  }

  let toastTimer = null;
  function showToast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 2600);
  }

  els.shareBtn.addEventListener("click", () => {
    copyText(buildShareURL()).then((ok) =>
      showToast(ok ? "Link copied — it reopens this shortlist" : "Couldn’t copy — copy the address bar instead")
    );
  });
  els.trayShare.addEventListener("click", () => runExport("link"));

  els.aiSubmitBtn.addEventListener("click", submitAIQuery);
  els.aiClearBtn.addEventListener("click", clearAIResults);
})();
