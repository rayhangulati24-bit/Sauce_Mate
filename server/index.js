import express from "express";
import cors from "cors";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

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

async function suggestWithGemini(term, apiKey) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini: ${res.status} ${err}`);
  }
  const data = await res.json();
  const text =
    data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "{}";
  return JSON.parse(text);
}

app.post("/api/suggest-sauces", async (req, res) => {
  const term = req.body?.term;
  if (!term || typeof term !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'term'" });
  }

  const provider = (process.env.AI_PROVIDER || "openai").toLowerCase();
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  try {
    if (provider === "gemini" && geminiKey) {
      const out = await suggestWithGemini(term.trim(), geminiKey);
      return res.json(out);
    }
    if ((provider === "openai" || !geminiKey) && openaiKey) {
      const out = await suggestWithOpenAI(term.trim(), openaiKey);
      return res.json(out);
    }
    return res.status(503).json({
      error: "No AI provider configured. Set OPENAI_API_KEY or GEMINI_API_KEY and optionally AI_PROVIDER=openai|gemini.",
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || "AI request failed" });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`SauceMate API listening on ${port}`));
