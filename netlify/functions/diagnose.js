/*
  AI-powered "describe your problem" search.

  POST { problem: "low open rate on our lifecycle emails" }
  ->   { matches: [{ id, rationale }, ...] }

  This is the one part of the project that isn't free — it calls the
  Anthropic API, which has a small usage-based cost (see SETUP.md for
  numbers). Everything else in this repo (hosting, the keyword search,
  filters) stays free with or without this function configured.

  Requires two environment variables, set in Netlify's dashboard
  (Site settings -> Environment variables), never committed to the repo:
    ANTHROPIC_API_KEY  - from https://console.anthropic.com
    ANTHROPIC_MODEL    - a current model id, e.g. a small/fast Claude model.
                          Check https://docs.claude.com/en/docs/about-claude/models
                          for the current list — model ids change over time,
                          so this is intentionally not hardcoded here.
*/

// IMPORTANT: these must be literal string paths, not built with path.join()/
// __dirname. Netlify's function bundler (esbuild) can only detect and pack
// files referenced by a literal require() path at build time; a computed
// path is invisible to it, so the data files never make it into the
// deployed function and this would fail at runtime with "Cannot find
// module" — which Netlify surfaces to the browser as an opaque 502, not a
// helpful error. Literal paths let esbuild inline the JSON directly into
// the bundled function, so no file lookup happens at runtime at all.
const useCaseData = require("../../data/use-cases.json");
const problemData = require("../../data/business-problems.json");

const MAX_PROBLEM_LENGTH = 500;
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";

function buildCatalog() {
  const problemLabels = {};
  (problemData.problems || []).forEach((p) => (problemLabels[p.id] = p.label));

  return useCaseData.useCases.map((uc) => ({
    id: uc.id,
    title: uc.title,
    oneLiner: uc.oneLiner,
    channels: uc.channels,
    businessProblemsAddressed: (uc.businessProblems || []).map((id) => problemLabels[id] || id),
    tags: uc.tags,
  }));
}

exports.handler = async (event) => {
  // Top-level safety net: if anything below throws unexpectedly, return a
  // readable JSON error instead of letting Netlify surface a bare 502 with
  // no explanation. Makes future issues self-diagnosing from the browser.
  try {
    return await handleRequest(event);
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unexpected function error: " + (err && err.message ? err.message : String(err)) }),
    };
  }
};

async function handleRequest(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Use POST" }) };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "ANTHROPIC_API_KEY is not configured on this deployment. See SETUP.md → 'AI-powered problem search'.",
      }),
    };
  }
  if (!process.env.ANTHROPIC_MODEL) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "ANTHROPIC_MODEL is not configured on this deployment. See SETUP.md → 'AI-powered problem search'.",
      }),
    };
  }

  let problem;
  try {
    const body = JSON.parse(event.body || "{}");
    problem = (body.problem || "").toString().trim();
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Malformed JSON body" }) };
  }

  if (!problem) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing 'problem' text" }) };
  }
  if (problem.length > MAX_PROBLEM_LENGTH) {
    problem = problem.slice(0, MAX_PROBLEM_LENGTH);
  }

  const catalog = buildCatalog();

  const payload = {
    model: process.env.ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content:
          "A consultant or client describes a business problem in their own words. " +
          "Given the catalog of personalization use cases below (as JSON), pick the 3-5 use cases " +
          "that most directly help address the described problem. If fewer than 3 are genuinely " +
          "relevant, return fewer rather than padding the list. Only use ids that appear exactly " +
          "in the catalog.\n\n" +
          'Problem described: "' +
          problem +
          '"\n\n' +
          "Catalog:\n" +
          JSON.stringify(catalog),
      },
    ],
    tools: [
      {
        name: "return_matches",
        description: "Return the use cases from the catalog that best address the described business problem, ranked most relevant first.",
        input_schema: {
          type: "object",
          properties: {
            matches: {
              type: "array",
              maxItems: 5,
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Exact use case id from the catalog" },
                  rationale: { type: "string", description: "One sentence on why this use case addresses the described problem" },
                },
                required: ["id", "rationale"],
              },
            },
          },
          required: ["matches"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "return_matches" },
  };

  let anthropicRes;
  try {
    anthropicRes = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: "Could not reach the Anthropic API: " + err.message }) };
  }

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text().catch(() => "");
    return {
      statusCode: anthropicRes.status,
      body: JSON.stringify({ error: "Anthropic API error (" + anthropicRes.status + "): " + errText.slice(0, 300) }),
    };
  }

  const data = await anthropicRes.json();
  const toolUse = (data.content || []).find((block) => block.type === "tool_use" && block.name === "return_matches");

  if (!toolUse || !toolUse.input || !Array.isArray(toolUse.input.matches)) {
    return { statusCode: 502, body: JSON.stringify({ error: "Unexpected response shape from the model." }) };
  }

  const validIds = new Set(catalog.map((c) => c.id));
  const matches = toolUse.input.matches.filter((m) => m && validIds.has(m.id)).slice(0, 5);

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ matches }),
  };
}
