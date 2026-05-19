import express from "express";
import cors from "cors";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATED_DB_FILE =
  process.env.GENERATED_FOOD_DB_FILE ||
  path.join(__dirname, "data", "generatedFoodDatabase.json");

let generatedFoodDatabase = {};
let generatedDatabaseWriteQueue = Promise.resolve();

function normalizeSearchTerm(term) {
  return String(term || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function loadGeneratedFoodDatabase() {
  try {
    const raw = await fs.readFile(GENERATED_DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    generatedFoodDatabase =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
  } catch (e) {
    if (e.code !== "ENOENT") {
      console.warn("Could not load generated food database:", e.message);
    }
    generatedFoodDatabase = {};
  }
}

async function writeGeneratedFoodDatabase() {
  await fs.mkdir(path.dirname(GENERATED_DB_FILE), { recursive: true });
  const tmpFile = `${GENERATED_DB_FILE}.tmp`;
  await fs.writeFile(
    tmpFile,
    `${JSON.stringify(generatedFoodDatabase, null, 2)}\n`,
    "utf8"
  );
  await fs.rename(tmpFile, GENERATED_DB_FILE);
}

const generatedDatabaseReady = loadGeneratedFoodDatabase();

async function getGeneratedSuggestion(term) {
  await generatedDatabaseReady;
  return generatedFoodDatabase[normalizeSearchTerm(term)] || null;
}

async function saveGeneratedSuggestion(term, provider, payload) {
  await generatedDatabaseReady;
  const key = normalizeSearchTerm(term);
  if (!key) return;

  generatedFoodDatabase[key] = {
    term: String(term).trim(),
    source: "ai",
    provider,
    generatedAt: new Date().toISOString(),
    suggestions: payload.suggestions,
  };

  generatedDatabaseWriteQueue = generatedDatabaseWriteQueue
    .catch(() => {})
    .then(writeGeneratedFoodDatabase);

  try {
    await generatedDatabaseWriteQueue;
  } catch (e) {
    console.warn("Could not save generated food database:", e.message);
  }
}

const SYSTEM_PROMPT = `You are a helpful assistant that suggests food pairings. If the user's input contains inappropriate, offensive, or adult content, respond with {"suggestions":[]}. Otherwise, provide sauce suggestions as a JSON object with a single key "suggestions" whose value is an array of 3-4 objects. Each object must have: "name" (string), "description" (short string), "type" (string, e.g. "sauce" or "dip"), and "recipe" (detailed string). Return only valid JSON, no markdown or extra text.`;

async function suggestWithOpenAI(term, apiKey) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Suggest 3-4 sauce or condiment pairings for: ${term}. Return only a JSON object with key "suggestions" and an array of objects with name, description, type, recipe.`,
        },
      ],
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
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-1.5-flash",
];

function geminiModelsToTry() {
  const fromEnv = (process.env.GEMINI_MODEL || "")
    .split(",")
    .map((m) => m.trim().replace(/^models\//, ""))
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_GEMINI_MODELS;
}

function formatGeminiError(status, body) {
  let message = "";
  try {
    const parsed = JSON.parse(body);
    message = parsed?.error?.message || "";
  } catch {
    message = body;
  }
  const quotaHit =
    status === 429 ||
    /quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(message);
  if (quotaHit) {
    return {
      status: 429,
      message:
        "Gemini free tier limit reached for this model. Wait a minute and try again. On Render, set GEMINI_MODEL=gemini-2.5-flash-lite (or enable billing in Google AI Studio).",
    };
  }
  return {
    status: status >= 400 && status < 600 ? status : 502,
    message: message
      ? `Gemini error: ${message.slice(0, 200)}`
      : "Gemini request failed. Check your API key and model name.",
  };
}

async function suggestWithGeminiOneModel(term, apiKey, model) {
  const res = await fetch(
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
                text: `${SYSTEM_PROMPT}\n\nUser request: Suggest 3-4 sauce or condiment pairings for: ${term}. Return only a JSON object with key "suggestions" and an array of objects with name, description, type, recipe. No markdown.`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
        },
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

async function suggestWithGemini(term, apiKey) {
  const models = geminiModelsToTry();
  let lastQuotaError = null;

  for (const model of models) {
    try {
      return await suggestWithGeminiOneModel(term, apiKey, model);
    } catch (e) {
      const formatted = formatGeminiError(e.status || 500, e.message || "");
      if (formatted.status === 429) {
        lastQuotaError = formatted;
        console.warn(`Gemini model ${model} quota exceeded, trying next…`);
        continue;
      }
      const err = new Error(formatted.message);
      err.status = formatted.status;
      throw err;
    }
  }

  const err = new Error(
    lastQuotaError?.message ||
      "All Gemini models are unavailable. Check your Google AI Studio quota."
  );
  err.status = 429;
  throw err;
}

app.post("/api/suggest-sauces", async (req, res) => {
  const term = req.body?.term;
  if (!term || typeof term !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'term'" });
  }
  const trimmedTerm = term.trim();

  const provider = resolveAiProvider();
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  try {
    const cached = await getGeneratedSuggestion(trimmedTerm);
    if (cached) {
      return res.json(normalizeSuggestionsPayload(cached));
    }

    if (provider === "gemini" && geminiKey) {
      const raw = await suggestWithGemini(trimmedTerm, geminiKey);
      const payload = normalizeSuggestionsPayload(raw);
      await saveGeneratedSuggestion(trimmedTerm, provider, payload);
      return res.json(payload);
    }
    if (provider === "openai" && openaiKey) {
      const raw = await suggestWithOpenAI(trimmedTerm, openaiKey);
      const payload = normalizeSuggestionsPayload(raw);
      await saveGeneratedSuggestion(trimmedTerm, provider, payload);
      return res.json(payload);
    }
    return res.status(503).json({
      error: "No AI provider configured. Set GEMINI_API_KEY and/or OPENAI_API_KEY (optional AI_PROVIDER=openai|gemini). For Gemini-only, GEMINI_API_KEY is enough.",
    });
  } catch (e) {
    console.error(e);
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

app.get("/health", (req, res) => {
  const provider = resolveAiProvider();
  res.json({
    ok: true,
    ai: {
      provider,
      configured:
        (provider === "gemini" && Boolean(process.env.GEMINI_API_KEY)) ||
        (provider === "openai" && Boolean(process.env.OPENAI_API_KEY)),
      geminiModels: provider === "gemini" ? geminiModelsToTry() : undefined,
    },
    generatedDatabase: {
      entries: Object.keys(generatedFoodDatabase).length,
      file: GENERATED_DB_FILE,
    },
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`SauceMate API listening on ${port}`));
