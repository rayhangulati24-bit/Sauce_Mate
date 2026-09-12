import express from "express";
import cors from "cors";
import {
  getGeneratedSuggestion,
  saveGeneratedSuggestion,
  rememberGeneratedSuggestion,
  getGeneratedCacheHealth,
  normalizeSearchTerm,
} from "./generatedCache.js";
import { foodDatabase } from "../src/data/foodDatabase.js";
import {
  NOT_FOOD_ERROR,
  isFoodSearchTerm,
  isNotFoodPayload,
} from "../shared/foodSearch.js";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

/** @type {Map<string, Promise<{ suggestions: unknown[] }>>} */
const pendingSuggestions = new Map();

const FOOD_ONLY_RULE =
  'If the input is not an edible food, dish, snack, drink, ingredient, or meal — or is inappropriate, offensive, or adult — return {"suggestions":[],"notFood":true}.';

const SYSTEM_PROMPT = `Suggest sauces for food. ${FOOD_ONLY_RULE} Otherwise return JSON {"suggestions":[...]} with 3 objects. Each: "name", "description" (max 14 words), "type" ("sauce" or "dip"), "recipe" (3 short steps). JSON only.`;

const EXPERIMENTAL_SYSTEM_PROMPT = `Suggest bold, unexpected sauce pairings. ${FOOD_ONLY_RULE} Otherwise return JSON {"suggestions":[...]} with 3 objects. Each: "name", "description" (max 14 words), "type" ("sauce" or "dip"), "recipe" (3 short steps). Favor surprising flavors. JSON only.`;

const AI_REQUEST_TIMEOUT_MS = 10000;

function buildUserPrompt(term, experimental) {
  const style = experimental
    ? "Give 3 bold fusion sauces for"
    : "Give 3 sauces for";
  return `${style} ${term}. JSON only.`;
}

async function fetchWithTimeout(url, options, timeoutMs = AI_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e.name === "AbortError") {
      const err = new Error("Request timed out");
      err.status = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function suggestWithOpenAI(term, apiKey, experimental = false) {
  const systemPrompt = experimental ? EXPERIMENTAL_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: buildUserPrompt(term, experimental),
        },
      ],
      max_tokens: 512,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI: ${res.status} ${err}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim() || "{}";
  return JSON.parse(text);
}

/** Prefer explicit AI_PROVIDER; otherwise pick from available keys. */
function resolveAiProvider() {
  const explicit = (process.env.AI_PROVIDER || "").toLowerCase().trim();
  if (explicit === "gemini" || explicit === "openai") return explicit;
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasOpenai = Boolean(process.env.OPENAI_API_KEY);
  if (hasGemini && !hasOpenai) return "gemini";
  if (hasOpenai && !hasGemini) return "openai";
  if (hasGemini && hasOpenai) return "openai";
  return "openai";
}

function normalizeSuggestionsPayload(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return { suggestions: [] };
  }
  const raw = Array.isArray(parsed.suggestions)
    ? parsed.suggestions
    : Array.isArray(parsed)
      ? parsed
      : [];
  const suggestions = raw
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      name: String(item.name ?? "").trim() || "Suggestion",
      description: String(item.description ?? "").trim(),
      type: String(item.type ?? "sauce").trim() || "sauce",
      recipe: String(item.recipe ?? "").trim(),
    }))
    .slice(0, 8);
  return { suggestions };
}

const DEFAULT_GEMINI_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
];

function geminiGenerationConfig(model, experimental) {
  const config = {
    temperature: experimental ? 0.8 : 0.4,
    maxOutputTokens: 512,
    responseMimeType: "application/json",
  };
  if (/^gemini-2\.5/.test(model)) {
    config.thinkingConfig = { thinkingBudget: 0 };
  }
  return config;
}

function geminiModelsToTry() {
  const fromEnv = (process.env.GEMINI_MODEL || "")
    .split(",")
    .map((m) => m.trim().replace(/^models\//, ""))
    .filter(Boolean);
  if (fromEnv.length === 0) return DEFAULT_GEMINI_MODELS;
  const seen = new Set(fromEnv);
  const fallbacks = DEFAULT_GEMINI_MODELS.filter((m) => !seen.has(m));
  return [...fromEnv, ...fallbacks];
}

function parseGeminiErrorBody(body) {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body);
    return String(parsed?.error?.message || parsed?.error?.status || "").trim();
  } catch {
    return String(body).trim();
  }
}

/** Transient failures (overload, quota, timeouts) — try the next Gemini model. */
function isRetryableGeminiError(status, body) {
  const message = parseGeminiErrorBody(body);
  const code = Number(status) || 0;
  if ([429, 500, 502, 503, 504].includes(code)) return true;
  return /quota|RESOURCE_EXHAUSTED|rate.?limit|overload|overloaded|UNAVAILABLE|high demand|try again|capacity|temporarily unavailable/i.test(
    message
  );
}

function formatGeminiError(status, body) {
  const message = parseGeminiErrorBody(body);
  const code = Number(status) || 502;
  const quotaHit =
    code === 429 ||
    /quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(message);
  const overloadHit =
    code === 503 ||
    /overload|overloaded|UNAVAILABLE|high demand/i.test(message);
  if (quotaHit) {
    return {
      status: 429,
      message:
        "Gemini is busy or rate-limited. Wait a moment and try again.",
    };
  }
  if (overloadHit) {
    return {
      status: 503,
      message: "Gemini is overloaded right now. Please try again in a moment.",
    };
  }
  return {
    status: code >= 400 && code < 600 ? code : 502,
    message: message
      ? `Gemini error: ${message.slice(0, 200)}`
      : "Gemini request failed. Check your API key and model name.",
  };
}

async function suggestWithGeminiOneModel(term, apiKey, model, experimental = false) {
  const systemPrompt = experimental ? EXPERIMENTAL_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${systemPrompt}\n\n${buildUserPrompt(term, experimental)}`,
              },
            ],
          },
        ],
        generationConfig: geminiGenerationConfig(model, experimental),
      }),
    }
  );
  const body = await res.text();
  if (!res.ok) {
    const err = new Error(body);
    err.status = res.status;
    err.model = model;
    throw err;
  }
  const data = JSON.parse(body);
  const text =
    data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "{}";
  return JSON.parse(text);
}

async function suggestWithGemini(term, apiKey, experimental = false) {
  const models = geminiModelsToTry();
  let lastRetryableError = null;

  for (const model of models) {
    try {
      const result = await suggestWithGeminiOneModel(term, apiKey, model, experimental);
      if (models.length > 1) {
        console.log(`Gemini suggestions via ${model}`);
      }
      return result;
    } catch (e) {
      const status = e.status || 500;
      const body = e.message || "";
      if (isRetryableGeminiError(status, body)) {
        lastRetryableError = formatGeminiError(status, body);
        console.warn(
          `Gemini model ${model} unavailable (${status}), trying next model…`
        );
        continue;
      }
      const formatted = formatGeminiError(status, body);
      const err = new Error(formatted.message);
      err.status = formatted.status;
      throw err;
    }
  }

  const err = new Error(
    lastRetryableError?.message ||
      "All Gemini models are busy. Please try again in a minute."
  );
  err.status = lastRetryableError?.status || 503;
  throw err;
}

function persistSuggestionInBackground(term, provider, payload, experimental) {
  rememberGeneratedSuggestion(term, provider, payload, experimental);
  void saveGeneratedSuggestion(term, provider, payload, experimental).catch((e) => {
    console.warn("Background cache save failed:", e.message);
  });
}

function rejectIfNotFood(raw, payload) {
  if (isNotFoodPayload(raw) || isNotFoodPayload(payload)) {
    const err = new Error(NOT_FOOD_ERROR);
    err.status = 400;
    err.notFood = true;
    throw err;
  }
  return payload;
}

async function fetchSuggestionsFromAi(trimmedTerm, provider, openaiKey, geminiKey, experimental = false) {
  if (provider === "gemini" && geminiKey) {
    const raw = await suggestWithGemini(trimmedTerm, geminiKey, experimental);
    const payload = rejectIfNotFood(raw, normalizeSuggestionsPayload(raw));
    persistSuggestionInBackground(trimmedTerm, provider, payload, experimental);
    return payload;
  }
  if (provider === "openai" && openaiKey) {
    const raw = await suggestWithOpenAI(trimmedTerm, openaiKey, experimental);
    const payload = rejectIfNotFood(raw, normalizeSuggestionsPayload(raw));
    persistSuggestionInBackground(trimmedTerm, provider, payload, experimental);
    return payload;
  }
  const err = new Error(
    "No AI provider configured. Set GEMINI_API_KEY and/or OPENAI_API_KEY (optional AI_PROVIDER=openai|gemini). For Gemini-only, GEMINI_API_KEY is enough."
  );
  err.status = 503;
  throw err;
}

app.post("/api/suggest-sauces", async (req, res) => {
  const term = req.body?.term;
  if (!term || typeof term !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'term'" });
  }
  const experimental = Boolean(req.body?.experimental);
  const trimmedTerm = term.trim();
  if (!isFoodSearchTerm(trimmedTerm, foodDatabase)) {
    return res.status(400).json({ error: NOT_FOOD_ERROR, notFood: true });
  }
  const cacheKey = experimental
    ? `${normalizeSearchTerm(trimmedTerm)}:experimental`
    : normalizeSearchTerm(trimmedTerm);

  const provider = resolveAiProvider();
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  try {
    const cached = await getGeneratedSuggestion(trimmedTerm, experimental);
    if (cached) {
      const payload = normalizeSuggestionsPayload(cached);
      if (isNotFoodPayload(payload)) {
        return res.status(400).json({ error: NOT_FOOD_ERROR, notFood: true });
      }
      console.log(`[suggest-sauces] cache hit: "${trimmedTerm}" (key: ${cacheKey})`);
      return res.json(payload);
    }

    console.log(`[suggest-sauces] cache miss: "${trimmedTerm}" (key: ${cacheKey})`);

    let pending = pendingSuggestions.get(cacheKey);
    if (!pending) {
      pending = fetchSuggestionsFromAi(
        trimmedTerm,
        provider,
        openaiKey,
        geminiKey,
        experimental
      ).finally(() => {
        pendingSuggestions.delete(cacheKey);
      });
      pendingSuggestions.set(cacheKey, pending);
    }

    const payload = await pending;
    return res.json(payload);
  } catch (e) {
    console.error(e);
    if (e.notFood) {
      return res.status(400).json({ error: NOT_FOOD_ERROR, notFood: true });
    }
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    const message = e.message || "AI request failed";
    const friendly =
      message.startsWith("Gemini") || message.startsWith("OpenAI")
        ? message.replace(/^(Gemini|OpenAI):\s*\d+\s*/, "").trim()
        : message.length > 280
          ? "AI request failed. Please try again in a minute."
          : message;
    return res.status(status).json({ error: friendly || "AI request failed" });
  }
});

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "SauceMate API",
    health: "/health",
    suggest: "POST /api/suggest-sauces",
  });
});

async function sendHealth(req, res) {
  const provider = resolveAiProvider();
  const generatedDatabase = await getGeneratedCacheHealth();
  res.json({
    ok: true,
    ai: {
      provider,
      configured:
        (provider === "gemini" && Boolean(process.env.GEMINI_API_KEY)) ||
        (provider === "openai" && Boolean(process.env.OPENAI_API_KEY)),
      geminiModels: provider === "gemini" ? geminiModelsToTry() : undefined,
    },
    generatedDatabase,
  });
}

app.get("/health", sendHealth);
app.get("/api/health", sendHealth);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`SauceMate API listening on ${port}`));
