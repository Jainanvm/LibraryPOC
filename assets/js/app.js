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
      quickWin: false,
    },
    ai: {
      active: false,
      problem: "",
      matches: [], // [{ id, rationale }]
    },
  };

  const els = {
    grid: document.getElementById("cardGrid"),
    resultsArea: document.getElementById("resultsArea"),
    intakePanel: document.getElementById("intakePanel"),
    intakeForm: document.getElementById("intakeForm"),
    intakeProblem: document.getElementById("intakeProblem"),
    intakeIndustry: document.getElementById("intakeIndustry"),
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
  ])
    .then(([useCaseData, problemData, industryData]) => {
      state.all = useCaseData.useCases || [];
      (problemData.problems || []).forEach((p) => {
        state.problemsById[p.id] = p;
      });
      (industryData.industries || []).forEach((industry) => {
        state.industriesById[industry.id] = industry;
      });
      populateIntakeOptions();
      buildFilterGroups();
      render();
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
  };

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
      channels: uc.channels.join(" ").toLowerCase(),
      problems: problemLabels,
      industries: industryLabels,
    };
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
    const tokens = expanded
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(canonicalize);
    let total = 0;
    for (const tok of tokens) {
      const s = scoreToken(tok, uc);
      if (s === 0) return { match: false, score: 0 }; // AND logic: every token must hit something
      total += s;
    }
    return { match: true, score: total };
  }

  // ---------- Filtering ----------

  function passesFilters(uc) {
    const f = state.filters;
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

  function appendTaxonomyFilterGroup(labelText, entries, filterKey) {
    if (!entries.length) return;
    const group = document.createElement("div");
    group.className = "filter-group filter-group-wide";
    const label = document.createElement("span");
    label.className = "filter-group-label";
    label.textContent = labelText;
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
    group.appendChild(chips);
    els.filterGroups.appendChild(group);
  }

  // ---------- Rendering ----------

  function channelLabel(c) {
    return { web: "Web", app: "App", email: "Email" }[c] || c;
  }

  function cardHTML(uc, rationale) {
    const channels = uc.channels.map((channel) => `<span class="meta-pill">${escapeHTML(channelLabel(channel))}</span>`).join("");
    const rationaleBlock = rationale
      ? `<p class="ai-rationale">${escapeHTML(rationale)}</p>`
      : "";
    return `
      <article class="card" tabindex="0" data-id="${uc.id}">
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

    els.grid.querySelectorAll(".card").forEach((card) => {
      card.addEventListener("click", () => openDetail(card.dataset.id));
      card.addEventListener("keypress", (e) => {
        if (e.key === "Enter") openDetail(card.dataset.id);
      });
    });
  }

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
    els.detailContent.innerHTML = detailHTML(uc);
    els.overlay.hidden = false;
    els.detailPanel.hidden = false;
    els.detailPanel.setAttribute("aria-hidden", "false");
    document.getElementById("detailCloseBtn").addEventListener("click", closeDetail);
    document.body.style.overflow = "hidden";
  }

  function closeDetail() {
    if (history.state?.useCaseDetail) {
      history.back();
      return;
    }
    hideDetail();
  }

  function hideDetail() {
    els.overlay.hidden = true;
    els.detailPanel.hidden = true;
    els.detailPanel.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
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

    els.grid.querySelectorAll(".card").forEach((card) => {
      card.addEventListener("click", () => openDetail(card.dataset.id));
      card.addEventListener("keypress", (e) => {
        if (e.key === "Enter") openDetail(card.dataset.id);
      });
    });
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

  function startBrowsing(problemId, industryId, quickWinsOnly) {
    Object.values(state.filters).forEach((filter) => {
      if (filter instanceof Set) filter.clear();
    });
    state.filters.quickWin = quickWinsOnly;
    if (problemId) state.filters.businessProblems.add(problemId);
    if (industryId) state.filters.industries.add(industryId);

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
    if (state.browsingStarted) updateBrief(problemId, industryId);
    else startBrowsing(problemId, industryId, false);
  });

  els.browseAllBtn.addEventListener("click", () => {
    els.intakeProblem.value = "";
    els.intakeIndustry.value = "";
    startBrowsing("", "", false);
  });

  els.missionShortcuts.forEach((shortcut) => {
    shortcut.addEventListener("click", () => {
      const mission = shortcut.dataset.mission;
      const problemId = mission === "quickWin" ? "" : mission;
      const quickWinsOnly = mission === "quickWin";
      els.intakeProblem.value = problemId;
      els.intakeIndustry.value = "";
      startBrowsing(problemId, "", quickWinsOnly);
    });
  });

  els.editBriefBtn.addEventListener("click", () => {
    els.intakeProblem.value = state.filters.businessProblems.values().next().value || "";
    els.intakeIndustry.value = state.filters.industries.values().next().value || "";
    state.editingBrief = true;
    if (els.refinePanel) els.refinePanel.open = false;
    render();
    scrollToSection(els.intakePanel);
    els.intakeProblem.focus({ preventScroll: true });
  });

  function updateBrief(problemId, industryId) {
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

  els.aiSubmitBtn.addEventListener("click", submitAIQuery);
  els.aiClearBtn.addEventListener("click", clearAIResults);
})();
