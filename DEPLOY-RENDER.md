# Deploy SauceMate on Render

You can run SauceMate in two ways:

- **Static site only** — built-in sauce database works; no AI.
- **Static site + API** — add Gemini or ChatGPT for “Find sauces” on any food.

---

## Option A: Static site only (no backend)

1. Push the repo to GitHub.
2. On Render: **New +** → **Static Site** → connect the repo.
3. Use these **exact** values:
   - **Root Directory:** leave **blank** (do not type `server` or anything).
   - **Build Command:** `npm install && npm run build`
   - **Publish Directory:** `dist`
4. Create the site. Built-in foods (fries, wings, burgers, etc.) work with no API.

---

## Option B: Static site + API (Gemini or ChatGPT)

Deploy **two** services and connect them with env vars.

### 1. Backend (API)

1. **New +** → **Web Service**.
2. Connect the same repo.
3. Configure:
   - **Name:** e.g. `sauce-mate-api`
   - **Root Directory:** `server` (so Render uses the `server/` folder).
   - **Runtime:** Node.
   - **Build command:** `npm ci`
   - **Start command:** `npm start`
4. **Environment** (required for AI):
   - **AI_PROVIDER** = `openai` or `gemini`
   - **OPENAI_API_KEY** = your OpenAI API key (if using ChatGPT).
   - **GEMINI_API_KEY** = your Google AI (Gemini) API key (if using Gemini).
5. Create the service. Note the URL, e.g. `https://sauce-mate-api.onrender.com`.

### 2. Frontend (static site)

1. **New +** → **Static Site** → same repo.
2. **Build command:** `npm install && npm run build`  
   **Publish directory:** `dist`
3. **Environment** (so the app calls your API):
   - **VITE_API_URL** = your API URL, e.g. `https://sauce-mate-api.onrender.com`  
     (no trailing slash). Set this before the first build—Vite bakes it in at build time.
4. Create the site. The app will use your backend when the user searches for a food that’s not in the built-in list.

### 3. (Optional) One-click with Blueprint

If you use **Blueprint** and apply `render.yaml`, it will create both services. You still need to set the env vars in the Render dashboard:

- **sauce-mate-api:** `AI_PROVIDER`, `OPENAI_API_KEY` and/or `GEMINI_API_KEY`
- **sauce-mate:** `VITE_API_URL` = the API service URL

---

## Env vars summary

| Service        | Variable        | Purpose |
|----------------|------------------|--------|
| sauce-mate-api | AI_PROVIDER      | `openai` or `gemini` |
| sauce-mate-api | OPENAI_API_KEY   | OpenAI API key (for ChatGPT) |
| sauce-mate-api | GEMINI_API_KEY   | Google AI API key (for Gemini) |
| sauce-mate     | VITE_API_URL     | Full API URL, e.g. `https://sauce-mate-api.onrender.com` |

Use either OpenAI or Gemini; set the key for the provider you choose and set `AI_PROVIDER` to match.

---

## Run locally with the API

**Terminal 1 – backend:**

```bash
cd server
npm install
OPENAI_API_KEY=sk-... npm start
# or: GEMINI_API_KEY=... AI_PROVIDER=gemini npm start
```

**Terminal 2 – frontend:**

```bash
npm install
VITE_API_URL=http://localhost:3000 npm run dev
```

Open the dev URL (e.g. `http://localhost:5173`). Searches for foods not in the built-in list will use your local API.

---

## Get API keys

- **OpenAI (ChatGPT):** [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- **Google (Gemini):** [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

---

## Troubleshooting: npm error on Render

If the build fails with an npm error, try this:

1. **Root Directory must be empty**  
   For the **static site**, leave **Root Directory** blank. If it’s set to `server` or anything else, the build will run in the wrong folder and fail.

2. **Use a lockfile (recommended)**  
   On your computer, in the project folder, run:
   ```bash
   # If you see "EPERM" or cache errors, fix npm’s cache first:
   sudo chown -R $(whoami) ~/.npm

   cd "/Users/ray/Desktop/sauce mate new"
   npm install
   ```
   Then commit and push the new `package-lock.json`:
   ```bash
   git add package-lock.json
   git commit -m "Add package-lock.json for Render"
   git push
   ```
   Redeploy on Render. The lockfile makes the build reproducible and often fixes dependency errors.

3. **Node version**  
   The repo has a `.node-version` file set to `20`, so Render should use Node 20. If your error mentions Node, in Render go to the static site → **Environment** and add **NODE_VERSION** = `20`, then redeploy.
