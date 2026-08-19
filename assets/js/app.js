/*
  Personalization Use Case Library — front-end logic.
  No frameworks, no build step, no external dependencies.
  Data lives in data/use-cases.json — edit that file (or use scripts/import_csv.py)
  to add cases; this file only needs to change if you add a new *filter type*.
*/

(function () {
  "use strict";

  const state = {
    all: [],
    problemsById: {},
    query: "",
    filters: {
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
    searchInput: document.getElementById("searchInput"),
    clearSearch: document.getElementById("clearSearch"),
    resultCount: document.getElementById("resultCount"),
    filterGroups: document.getElementById("filterGroups"),
    emptyState: document.getElementById("emptyState"),
    overlay: document.getElementById("overlay"),
    detailPanel: document.getElementById("detailPanel"),
    detailContent: document.getElementById("detailContent"),
    aiProblemInput: document.getElementById("aiProblemInput"),
    aiSubmitBtn: document.getElementById("aiSubmitBtn"),
    aiStatus: document.getElementById("aiStatus"),
    aiResultsBanner: document.getElementById("aiResultsBanner"),
    aiResultsText: document.getElementById("aiResultsText"),
    aiClearBtn: document.getElementById("aiClearBtn"),
    searchPanel: document.querySelector(".search-panel"),
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
  ])
    .then(([useCaseData, problemData]) => {
      state.all = useCaseData.useCases || [];
      (problemData.problems || []).forEach((p) => {
        state.problemsById[p.id] = p;
      });
      buildFilterGroups();
      render();
    })
    .catch((err) => {
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
    uc.__tokens = {
      tags: (uc.tags || []).map((t) => t.toLowerCase()),
      title: uc.title.toLowerCase(),
      oneLiner: uc.oneLiner.toLowerCase(),
      tactic: uc.personalizationTactic.toLowerCase(),
      cdp: (uc.cdpDataUsed || []).join(" | ").toLowerCase(),
      journey: uc.journey.toLowerCase(),
      channels: uc.channels.join(" ").toLowerCase(),
      problems: problemLabels,
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

    // Business problem is the primary lens — build it first, from whatever
    // problem ids are actually referenced by at least one use case.
    const usedProblemIds = new Set();
    state.all.forEach((uc) => (uc.businessProblems || []).forEach((id) => usedProblemIds.add(id)));
    const problemEntries = Object.values(state.problemsById).filter((p) => usedProblemIds.has(p.id));

    if (problemEntries.length) {
      const group = document.createElement("div");
      group.className = "filter-group filter-group-wide";
      const label = document.createElement("span");
      label.className = "filter-group-label";
      label.textContent = "Business problem";
      const chips = document.createElement("div");
      chips.className = "filter-chips";

      problemEntries.forEach((p) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip";
        chip.textContent = p.label;
        chip.title = p.description || "";
        chip.addEventListener("click", () => {
          const set = state.filters.businessProblems;
          if (set.has(p.id)) set.delete(p.id);
          else set.add(p.id);
          chip.classList.toggle("active");
          render();
        });
        chips.appendChild(chip);
      });

      group.appendChild(label);
      group.appendChild(chips);
      els.filterGroups.appendChild(group);
    }

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
        chip.addEventListener("click", () => {
          const set = state.filters[def.key];
          if (set.has(v)) set.delete(v);
          else set.add(v);
          chip.classList.toggle("active");
          render();
        });
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
    qwChip.addEventListener("click", () => {
      state.filters.quickWin = !state.filters.quickWin;
      qwChip.classList.toggle("active");
      render();
    });
    qwChips.appendChild(qwChip);
    qwGroup.appendChild(qwLabel);
    qwGroup.appendChild(qwChips);
    els.filterGroups.appendChild(qwGroup);
  }

  // ---------- Rendering ----------

  function channelLabel(c) {
    return { web: "Web", app: "App", email: "Email" }[c] || c;
  }

  function cardHTML(uc, rationale) {
    const channels = uc.channels.map((c) => `<span class="channel-badge">${channelLabel(c)}</span>`).join("");
    const quickWin = uc.quickWin ? `<span class="quickwin-badge">⚡ Quick win</span>` : "";
    const aiBadge = rationale ? `<span class="ai-match-badge">AI match</span>` : "";
    const rationaleBlock = rationale ? `<p class="ai-rationale">${rationale}</p>` : "";
    return `
      <article class="card" tabindex="0" data-id="${uc.id}">
        <div class="card-top">
          <div class="channel-icons">${channels}</div>
          ${aiBadge}${quickWin}
        </div>
        <h3 class="card-title">${uc.title}</h3>
        <p class="card-oneliner">${uc.oneLiner}</p>
        ${rationaleBlock}
        <div class="card-meta">
          <span class="meta-pill complexity-${uc.complexity}">${uc.complexity} complexity</span>
          <span class="meta-pill">${uc.funnelStage}</span>
          <span class="meta-pill">${uc.dataMaturity} data</span>
        </div>
      </article>
    `;
  }

  function render() {
    if (state.ai.active) {
      renderAIResults();
      return;
    }
    els.searchPanel.hidden = false;
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

  function detailHTML(uc) {
    const channels = uc.channels.map((c) => `<span class="meta-pill">${channelLabel(c)}</span>`).join("");
    const cdpList = uc.cdpDataUsed.map((d) => `<li>${d}</li>`).join("");
    const toolsList = uc.toolsNeeded.map((t) => `<li>${t}</li>`).join("");
    const secondaryKpis = uc.kpis.secondary.map((k) => `<span class="kpi-secondary">${k}</span>`).join("");
    const problemPills = (uc.businessProblems || [])
      .map((id) => state.problemsById[id])
      .filter(Boolean)
      .map((p) => `<span class="problem-pill" title="${p.description || ""}">${p.label}</span>`)
      .join("");

    return `
      <button class="detail-close" id="detailCloseBtn" aria-label="Close">×</button>
      <p class="detail-eyebrow">${uc.personalizationTactic}</p>
      <h2 class="detail-title">${uc.title}</h2>
      <p class="detail-oneliner">${uc.oneLiner}</p>

      <div class="detail-badges">
        ${channels}
        <span class="meta-pill complexity-${uc.complexity}">${uc.complexity} complexity</span>
        <span class="meta-pill">${uc.funnelStage}</span>
        <span class="meta-pill">${uc.dataMaturity} CDP data</span>
        ${uc.quickWin ? '<span class="quickwin-badge">⚡ Quick win</span>' : ""}
      </div>

      ${problemPills ? `<div class="detail-section"><h3>Solves for</h3><div class="detail-badges">${problemPills}</div></div>` : ""}

      <div class="detail-section">
        <h3>Customer journey</h3>
        <p>${uc.journey}</p>
      </div>

      <div class="detail-section">
        <h3>Before → after</h3>
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
        <h3>Impact</h3>
        <div class="kpi-row">
          <span class="kpi-primary">${uc.kpis.primary}</span>
          ${secondaryKpis}
        </div>
      </div>

      <div class="detail-section">
        <h3>What you need to build it</h3>
        <ul>${toolsList}</ul>
      </div>
    `;
  }

  function openDetail(id) {
    const uc = state.all.find((u) => u.id === id);
    if (!uc) return;
    els.detailContent.innerHTML = detailHTML(uc);
    els.overlay.hidden = false;
    els.detailPanel.hidden = false;
    els.detailPanel.setAttribute("aria-hidden", "false");
    document.getElementById("detailCloseBtn").addEventListener("click", closeDetail);
    document.body.style.overflow = "hidden";
  }

  function closeDetail() {
    els.overlay.hidden = true;
    els.detailPanel.hidden = true;
    els.detailPanel.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  els.overlay.addEventListener("click", closeDetail);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetail();
  });

  // ---------- Search input wiring ----------

  let debounceTimer = null;
  els.searchInput.addEventListener("input", (e) => {
    state.query = e.target.value;
    els.clearSearch.classList.toggle("visible", !!state.query);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, 80);
  });

  els.clearSearch.addEventListener("click", () => {
    els.searchInput.value = "";
    state.query = "";
    els.clearSearch.classList.remove("visible");
    render();
    els.searchInput.focus();
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
    els.searchPanel.hidden = true;
    els.aiResultsBanner.hidden = false;
    els.aiResultsText.textContent = state.ai.matches.length
      ? `${state.ai.matches.length} AI-matched use case${state.ai.matches.length === 1 ? "" : "s"} for: "${state.ai.problem}"`
      : `No strong matches found for: "${state.ai.problem}"`;

    const cards = state.ai.matches
      .map((m) => {
        const uc = state.all.find((u) => u.id === m.id);
        return uc ? cardHTML(uc, m.rationale) : "";
      })
      .join("");

    els.grid.innerHTML = cards;
    els.emptyState.hidden = state.ai.matches.length !== 0;
    els.resultCount.textContent = `${state.ai.matches.length} AI match${state.ai.matches.length === 1 ? "" : "es"}`;

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
      setAIStatus("Type a short description of the problem first.", true);
      return;
    }

    els.aiSubmitBtn.disabled = true;
    els.aiSubmitBtn.textContent = "Thinking…";
    setAIStatus("Reading the library against your problem…", false);

    try {
      const res = await fetch("/.netlify/functions/diagnose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ problem }),
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
      setAIStatus(
        "Couldn't run AI search (" +
          err.message +
          "). This feature needs the site deployed to Netlify with an Anthropic API key configured — see SETUP.md. You can still browse and search normally below.",
        true
      );
    } finally {
      els.aiSubmitBtn.disabled = false;
      els.aiSubmitBtn.textContent = "Find relevant use cases";
    }
  }

  function clearAIResults() {
    state.ai.active = false;
    state.ai.matches = [];
    state.ai.problem = "";
    els.aiProblemInput.value = "";
    setAIStatus("", false);
    render();
  }

  els.aiSubmitBtn.addEventListener("click", submitAIQuery);
  els.aiProblemInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitAIQuery();
  });
  els.aiClearBtn.addEventListener("click", clearAIResults);
})();
