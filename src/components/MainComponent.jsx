import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";

import { useAuth } from "../contexts/AuthContext";
import { foodDatabase } from "../data/foodDatabase";
import SpinningBottle from "./SpinningBottle";
import ExperimentalModeToggle from "./ExperimentalModeToggle";
import menuIcon from "../assets/menu-icon.png";

/** Convert a key like "fishFingers" to "Fish Fingers" */
function keyToDisplayName(key) {
  return key.replace(/([A-Z])/g, " $1").trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Production: VITE_API_URL. Local dev: Vite proxies /api to the backend. */
function getApiBaseUrl() {
  const configured = import.meta.env.VITE_API_URL?.replace(/\/$/, "");
  if (configured) return configured;
  if (import.meta.env.DEV) return "";
  return null;
}

const API_SEARCH_TIMEOUT_MS = 18000;
const clientSuggestionCache = new Map();

function normalizeClientSearchKey(term) {
  return String(term || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function clientSuggestionCacheKey(term, experimental) {
  return `${normalizeClientSearchKey(term)}:${experimental ? "1" : "0"}`;
}

function readClientSuggestion(term, experimental) {
  const key = clientSuggestionCacheKey(term, experimental);
  if (clientSuggestionCache.has(key)) return clientSuggestionCache.get(key);
  try {
    const raw = sessionStorage.getItem(`saucemate:suggest:${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.suggestions)) {
      clientSuggestionCache.set(key, parsed);
      return parsed;
    }
  } catch {
    /* ignore quota / private mode */
  }
  return null;
}

function writeClientSuggestion(term, experimental, data) {
  if (!data || !Array.isArray(data.suggestions)) return;
  const key = clientSuggestionCacheKey(term, experimental);
  const stored = { suggestions: data.suggestions };
  clientSuggestionCache.set(key, stored);
  try {
    sessionStorage.setItem(`saucemate:suggest:${key}`, JSON.stringify(stored));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Build a per-user localStorage key so multiple accounts on one device don't share. */
function savedSaucesStorageKey(user) {
  return `saucemate:savedSauces:${user?.id || "guest"}`;
}

function readSavedSauces(user) {
  try {
    const raw = localStorage.getItem(savedSaucesStorageKey(user));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readExperimentalMode() {
  try {
    return localStorage.getItem("saucemate:experimentalMode") === "true";
  } catch {
    return false;
  }
}

function tagExperimentalSuggestions(suggestions) {
  if (!Array.isArray(suggestions)) return [];
  return suggestions.map((s) => ({ ...s, experimental: true }));
}

function experimentalCatalogFood() {
  return {
    suggestions: tagExperimentalSuggestions(
      foodDatabase.experimentalPairings?.suggestions || []
    ),
  };
}

const ANIMATION_KEY_MAP = {
  // gold swirl
  a: { kind: "swirl", color: "#d4a017" },
  b: { kind: "swirl", color: "#d4a017" },
  c: { kind: "swirl", color: "#d4a017" },
  f: { kind: "swirl", color: "#d4a017" },
  h: { kind: "swirl", color: "#d4a017" },
  i: { kind: "swirl", color: "#d4a017" },
  // burgundy flow
  j: { kind: "flow", color: "#8b1e3f" },
  k: { kind: "flow", color: "#8b1e3f" },
  l: { kind: "flow", color: "#8b1e3f" },
  m: { kind: "flow", color: "#8b1e3f" },
  o: { kind: "flow", color: "#8b1e3f" },
  p: { kind: "flow", color: "#8b1e3f" },
  q: { kind: "flow", color: "#8b1e3f" },
  // purple ribbon
  r: { kind: "ribbon", color: "#5b2c6f" },
  u: { kind: "ribbon", color: "#5b2c6f" },
  v: { kind: "ribbon", color: "#5b2c6f" },
  w: { kind: "ribbon", color: "#5b2c6f" },
  x: { kind: "ribbon", color: "#5b2c6f" },
  z: { kind: "ribbon", color: "#5b2c6f" },
  // rocket → firework (space + common word endings)
  " ": { kind: "firework", color: "#f4d35e", style: "space" },
  e: { kind: "firework", color: "#d4a017", style: "swirl" },
  d: { kind: "firework", color: "#d4a017", style: "swirl" },
  g: { kind: "firework", color: "#d4a017", style: "swirl" },
  n: { kind: "firework", color: "#8b1e3f", style: "flow" },
  s: { kind: "firework", color: "#5b2c6f", style: "ribbon" },
  t: { kind: "firework", color: "#5b2c6f", style: "ribbon" },
  y: { kind: "firework", color: "#5b2c6f", style: "ribbon" },
};

function getInsertedLetter(prevValue, nextValue, selectionStart) {
  if (nextValue.length <= prevValue.length) return null;
  const idx = Math.max(0, (selectionStart ?? nextValue.length) - 1);
  const ch = nextValue[idx];
  if (ch === " ") return " ";
  if (ch && /[a-z]/i.test(ch)) return ch.toLowerCase();
  for (let i = 0; i < nextValue.length; i += 1) {
    if (nextValue[i] !== prevValue[i]) {
      if (nextValue[i] === " ") return " ";
      return /[a-z]/i.test(nextValue[i]) ? nextValue[i].toLowerCase() : null;
    }
  }
  return null;
}

function spiralCoords({ cx, cy, startAngle, turns, startR, endR, dir, t }) {
  const grow = t * t * (3 - 2 * t);
  const angle = startAngle + dir * turns * Math.PI * 2 * t;
  const r = startR + (endR - startR) * grow;
  return {
    x: cx + Math.cos(angle) * r,
    y: cy + Math.sin(angle) * r,
    angle,
    r,
  };
}

function buildSpiralPath(opts, steps = 96) {
  let d = "";
  for (let i = 0; i <= steps; i += 1) {
    const { x, y } = spiralCoords({ ...opts, t: i / steps });
    d += `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d.trim();
}

function createSwirlGeometry(radius) {
  const size = radius * 2.7;
  const cx = size / 2;
  const cy = size / 2;
  const mainDir = Math.random() > 0.5 ? 1 : -1;
  const originAngle = Math.random() * Math.PI * 2;
  const arms = [];

  const mains = [
    {
      dir: mainDir,
      turns: 2.05 + Math.random() * 0.45,
      endR: radius,
      width: 10.5 + Math.random() * 3.2,
      delay: 0,
      angle: originAngle,
    },
    {
      dir: -mainDir,
      turns: 1.75 + Math.random() * 0.4,
      endR: radius * (0.78 + Math.random() * 0.16),
      width: 8.5 + Math.random() * 2.6,
      delay: 0.05,
      angle: originAngle + Math.PI * (0.45 + Math.random() * 0.25),
    },
  ];

  mains.forEach((arm, i) => {
    const mainOpts = {
      cx,
      cy,
      startAngle: arm.angle,
      turns: arm.turns,
      startR: 3,
      endR: arm.endR,
      dir: arm.dir,
    };
    arms.push({
      d: buildSpiralPath(mainOpts),
      strokeWidth: arm.width + 4,
      delay: arm.delay,
      isBranch: false,
    });

    const forkT = 0.3 + Math.random() * 0.2;
    const fork = spiralCoords({ ...mainOpts, t: forkT });
    const branchDir = i === 0 || Math.random() > 0.28 ? -arm.dir : arm.dir;
    arms.push({
      d: buildSpiralPath({
        cx,
        cy,
        startAngle: fork.angle + branchDir * (0.35 + Math.random() * 0.4),
        turns: 0.85 + Math.random() * 0.4,
        startR: fork.r,
        endR: fork.r + radius * (0.26 + Math.random() * 0.22),
        dir: branchDir,
      }),
      strokeWidth: arm.width * 0.92,
      delay: arm.delay + 0.12,
      isBranch: true,
    });
  });

  if (Math.random() > 0.3) {
    const extraDir = Math.random() > 0.5 ? 1 : -1;
    arms.push({
      d: buildSpiralPath({
        cx,
        cy,
        startAngle: originAngle + Math.PI * (0.8 + Math.random() * 0.5),
        turns: 1.05 + Math.random() * 0.35,
        startR: radius * 0.16,
        endR: radius * (0.52 + Math.random() * 0.14),
        dir: extraDir,
      }),
      strokeWidth: 6.2 + Math.random() * 2,
      delay: 0.16,
      isBranch: true,
    });
  }

  return {
    size,
    dir: mainDir,
    arms,
    armLead: arms.reduce((max, arm) => Math.max(max, arm.delay), 0),
  };
}

function fireworkLaunchAndBurst() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const leftSide = Math.random() > 0.5;
  const x = leftSide
    ? vw * (0.05 + Math.random() * 0.12)
    : vw * (0.83 + Math.random() * 0.12);
  const launchX = x + (Math.random() - 0.5) * 20;
  const launchY = vh * (0.74 + Math.random() * 0.18);
  const burstX = Math.min(Math.max(x + (Math.random() - 0.5) * vw * 0.06, 28), vw - 28);
  const burstY = vh * (0.07 + Math.random() * 0.16);
  return { launchX, launchY, burstX, burstY };
}

function buildScribbleRay({ cx, cy, angle, length, steps = 11 }) {
  const nx = Math.cos(angle + Math.PI / 2);
  const ny = Math.sin(angle + Math.PI / 2);
  const phase = Math.random() * Math.PI * 2;
  let d = `M ${cx.toFixed(1)} ${cy.toFixed(1)}`;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const r = length * t;
    const wobble = Math.sin(phase + t * Math.PI * 3.1) * (6 + length * 0.035) * t;
    const x = cx + Math.cos(angle) * r + nx * wobble;
    const y = cy + Math.sin(angle) * r + ny * wobble;
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

function createScribbleBurst() {
  const size = 260;
  const cx = size / 2;
  const cy = size / 2;
  const count = 6 + Math.floor(Math.random() * 2);
  const origin = Math.random() * Math.PI * 2;
  const rays = [];
  for (let i = 0; i < count; i += 1) {
    const angle = origin + (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.22;
    rays.push({
      d: buildScribbleRay({
        cx,
        cy,
        angle,
        length: 68 + Math.random() * 42,
      }),
      strokeWidth: 5.2 + Math.random() * 1.6,
      delay: i * 0.07,
    });
  }
  const rocket = buildSpiralPath({
    cx: 32,
    cy: 32,
    startAngle: Math.random() * Math.PI * 2,
    turns: 1.45,
    startR: 3,
    endR: 20,
    dir: Math.random() > 0.5 ? 1 : -1,
  }, 48);
  return { size, rays, rocket };
}

function randomBackgroundPoint() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const keepout = {
    left: vw * 0.1,
    right: vw * 0.9,
    top: vh * 0.16,
    bottom: vh * 0.74,
  };
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const x = Math.random() * vw;
    const y = Math.random() * vh;
    const inKeepout =
      x > keepout.left &&
      x < keepout.right &&
      y > keepout.top &&
      y < keepout.bottom;
    if (!inKeepout) return { x, y };
  }
  const edge = Math.floor(Math.random() * 4);
  if (edge === 0) return { x: Math.random() * vw, y: Math.random() * keepout.top };
  if (edge === 1) return { x: Math.random() * vw, y: keepout.bottom + Math.random() * (vh - keepout.bottom) };
  if (edge === 2) return { x: Math.random() * keepout.left, y: Math.random() * vh };
  return { x: keepout.right + Math.random() * (vw - keepout.right), y: Math.random() * vh };
}

function spawnExperimentalParticles(key, addParticles) {
  const mapping = ANIMATION_KEY_MAP[key];
  if (!mapping) return;

  const { kind, color } = mapping;
  const dir = Math.random() > 0.5 ? 1 : -1;
  const created = [];
  const count = 1;

  for (let i = 0; i < count; i += 1) {
    const point = randomBackgroundPoint();
    const id = `${Date.now()}-${kind}-${i}-${Math.random().toString(36).slice(2, 7)}`;

    if (kind === "firework") {
      const path = fireworkLaunchAndBurst();
      const burst = createScribbleBurst();
      const rocketDuration = 1.18 + Math.random() * 0.1;
      const burstDuration = 1.4 + Math.random() * 0.15;
      const splitAt = rocketDuration * 0.4;
      created.push({
        id,
        kind: "firework",
        color,
        style: mapping.style || "space",
        rocketDuration,
        burstDuration,
        splitAt,
        duration: splitAt + burstDuration,
        delay: i * 0.08,
        wave: (Math.random() > 0.5 ? 1 : -1) * (36 + Math.random() * 28),
        ...path,
        ...burst,
      });
    } else if (kind === "swirl") {
      const radius = 70 + Math.random() * 90;
      const geometry = createSwirlGeometry(radius);
      created.push({
        id,
        kind: "swirl",
        x: point.x,
        y: point.y,
        color,
        spinDuration: 2.2 + Math.random() * 0.7,
        delay: i * 0.08,
        ...geometry,
      });
    } else if (kind === "flow") {
      created.push({
        id,
        kind: "flow",
        x: point.x,
        y: point.y,
        width: 180 + Math.random() * 200,
        height: 34 + Math.random() * 40,
        color,
        dx: dir * (220 + Math.random() * 200),
        dy: -30 + (Math.random() - 0.5) * 120,
        wave: dir * (70 + Math.random() * 60),
        duration: 2 + Math.random() * 0.8,
        delay: i * 0.1,
        dir,
      });
    } else {
      created.push({
        id,
        kind: "ribbon",
        x: point.x,
        y: point.y,
        width: 150 + Math.random() * 170,
        height: 28 + Math.random() * 36,
        color,
        dx: dir * (180 + Math.random() * 180),
        dy: -60 - Math.random() * 100,
        wave: dir * (80 + Math.random() * 70),
        twist: dir * (420 + Math.random() * 180),
        duration: 2.1 + Math.random() * 0.7,
        delay: i * 0.09,
        dir,
      });
    }
  }

  addParticles(created);
}

function MainComponent() {
  const {
    user,
    loading: authLoading,
    signIn,
    signUp,
    signOut,
    updateProfile,
    updatePassword,
    isAuthEnabled,
  } = useAuth();
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFood, setSelectedFood] = useState(null);
  const [selectedSauce, setSelectedSauce] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authTab, setAuthTab] = useState("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [bottleSpinning, setBottleSpinning] = useState(false);
  const bottleSpinTimerRef = useRef(null);
  const searchAbortRef = useRef(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState("saved");
  const [savedSauces, setSavedSauces] = useState(() => readSavedSauces(null));
  const [menuSpinning, setMenuSpinning] = useState(false);
  const menuSpinTimerRef = useRef(null);
  const [experimentalMode, setExperimentalMode] = useState(readExperimentalMode);
  const [typingParticles, setTypingParticles] = useState([]);
  const searchInputRef = useRef(null);
  const particleTimersRef = useRef([]);

  useEffect(() => {
    try {
      localStorage.setItem("saucemate:experimentalMode", String(experimentalMode));
    } catch (err) {
      console.error("Failed to persist experimental mode:", err);
    }
    if (!experimentalMode) {
      setTypingParticles([]);
    }
  }, [experimentalMode]);

  useEffect(() => {
    return () => {
      particleTimersRef.current.forEach((id) => clearTimeout(id));
      particleTimersRef.current = [];
    };
  }, []);

  const addTypingParticles = useCallback((created) => {
    setTypingParticles((prev) => [...prev, ...created].slice(-24));
    created.forEach((particle) => {
      const lifetime =
        (particle.spinDuration || particle.duration || 2) * 1000 +
        ((particle.delay || 0) + (particle.armLead || 0)) * 1000 +
        80;
      const timer = setTimeout(() => {
        setTypingParticles((prev) => prev.filter((p) => p.id !== particle.id));
      }, lifetime);
      particleTimersRef.current.push(timer);
    });
  }, []);

  const handleSearchInputChange = useCallback(
    (e) => {
      const next = e.target.value;
      const letter = getInsertedLetter(searchInput, next, e.target.selectionStart);
      setSearchInput(next);
      if (error) setError("");
      if (experimentalMode && letter) {
        spawnExperimentalParticles(letter, addTypingParticles);
      }
    },
    [searchInput, error, experimentalMode, addTypingParticles]
  );

  const handleSearchKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter") {
        e.currentTarget.form?.requestSubmit();
      }
    },
    []
  );

  useEffect(() => {
    return () => {
      if (menuSpinTimerRef.current) clearTimeout(menuSpinTimerRef.current);
    };
  }, []);

  const [profileName, setProfileName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [accountSubmitting, setAccountSubmitting] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [accountNotice, setAccountNotice] = useState("");

  useEffect(() => {
    setSavedSauces(readSavedSauces(user));
    setProfileName(user?.user_metadata?.full_name || "");
    setAccountError("");
    setAccountNotice("");
    setNewPassword("");
    setConfirmPassword("");
  }, [user]);

  useEffect(() => {
    try {
      localStorage.setItem(savedSaucesStorageKey(user), JSON.stringify(savedSauces));
    } catch (err) {
      console.error("Failed to persist saved sauces:", err);
    }
  }, [savedSauces, user]);

  const isSauceSaved = useCallback(
    (sauce) =>
      !!sauce && savedSauces.some((s) => s.name?.toLowerCase() === sauce.name?.toLowerCase()),
    [savedSauces]
  );

  const toggleSavedSauce = useCallback(
    (sauce, foodContext) => {
      if (!sauce?.name) return;
      setSavedSauces((prev) => {
        const exists = prev.some(
          (s) => s.name?.toLowerCase() === sauce.name.toLowerCase()
        );
        if (exists) {
          return prev.filter(
            (s) => s.name?.toLowerCase() !== sauce.name.toLowerCase()
          );
        }
        return [
          {
            name: sauce.name,
            description: sauce.description || "",
            type: sauce.type || "",
            recipe: sauce.recipe || "",
            food: foodContext || "",
            savedAt: new Date().toISOString(),
          },
          ...prev,
        ];
      });
    },
    []
  );

  const removeSavedSauce = useCallback((name) => {
    setSavedSauces((prev) =>
      prev.filter((s) => s.name?.toLowerCase() !== name?.toLowerCase())
    );
  }, []);

  const startBottleSpin = useCallback((durationMs) => {
    if (bottleSpinTimerRef.current) {
      clearTimeout(bottleSpinTimerRef.current);
      bottleSpinTimerRef.current = null;
    }
    setBottleSpinning(true);
    if (durationMs != null) {
      bottleSpinTimerRef.current = setTimeout(() => {
        setBottleSpinning(false);
        bottleSpinTimerRef.current = null;
      }, durationMs);
    }
  }, []);

  const stopBottleSpin = useCallback(() => {
    if (bottleSpinTimerRef.current) {
      clearTimeout(bottleSpinTimerRef.current);
      bottleSpinTimerRef.current = null;
    }
    setBottleSpinning(false);
  }, []);

  useEffect(() => {
    return () => {
      if (bottleSpinTimerRef.current) clearTimeout(bottleSpinTimerRef.current);
      searchAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const apiBase = getApiBaseUrl();
    if (apiBase === null) return;
    fetch(`${apiBase}/api/health`).catch(() => {});
  }, []);

  // Autocomplete: filter local suggestions as user types (no API calls)
  const autocompleteMatches = useMemo(() => {
    if (!searchInput.trim()) return [];
    const searchWords = searchInput.toLowerCase().split(/\s+/).join("");
    return Object.keys(foodDatabase).filter((key) =>
      key.toLowerCase().includes(searchWords)
    );
  }, [searchInput]);

  const displayedSuggestions = useMemo(() => {
    const suggestions = selectedFood?.suggestions;
    if (!Array.isArray(suggestions)) return [];
    if (!experimentalMode) {
      return suggestions.filter((item) => !item.experimental);
    }
    const experimentalOnly = suggestions.filter((item) => item.experimental);
    return experimentalOnly.length > 0
      ? experimentalOnly
      : experimentalCatalogFood().suggestions;
  }, [selectedFood, experimentalMode]);


  const handleSearch = useCallback(
    async (term) => {
      const trimmed = term.trim();
      if (!trimmed) return;

      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
        searchAbortRef.current = null;
      }
      stopBottleSpin();
      setLoading(false);

      setSearchInput(trimmed);
      setSearchTerm(trimmed.toLowerCase());
      setSelectedSauce(null);

      if (trimmed.toLowerCase() === "rayhan gulati") {
        setError("He is the creator of this app!");
        setSelectedFood(null);
        return;
      }

      setError("");
      const searchWords = trimmed.toLowerCase().split(/\s+/).join("");
      const matches = Object.keys(foodDatabase).filter((key) =>
        key.toLowerCase().includes(searchWords)
      );
      const localKey = matches[0];
      const isExperimentalCatalog = localKey === "experimentalPairings";
      const skipNormalLocalPairings =
        experimentalMode && matches.length > 0 && !isExperimentalCatalog;

      if (matches.length > 0 && !skipNormalLocalPairings) {
        const food = foodDatabase[localKey];
        setSelectedFood({
          ...food,
          suggestions: experimentalMode
            ? tagExperimentalSuggestions(food.suggestions)
            : food.suggestions,
        });
        return;
      }

      if (skipNormalLocalPairings) {
        const cachedExperimental = readClientSuggestion(trimmed, true);
        if (cachedExperimental) {
          setSelectedFood({
            ...cachedExperimental,
            suggestions: tagExperimentalSuggestions(cachedExperimental.suggestions),
          });
          return;
        }
        setSelectedFood(experimentalCatalogFood());
        return;
      }

      const cached = readClientSuggestion(trimmed, experimentalMode);
      if (cached) {
        setSelectedFood({
          ...cached,
          suggestions: experimentalMode
            ? tagExperimentalSuggestions(cached.suggestions)
            : cached.suggestions,
        });
        return;
      }

      const apiBase = getApiBaseUrl();
      if (apiBase === null) {
        setError(
          "AI search is not configured. Set VITE_API_URL on your static site to your API URL (see DEPLOY-RENDER.md)."
        );
        setSelectedFood(null);
        return;
      }

      const controller = new AbortController();
      searchAbortRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), API_SEARCH_TIMEOUT_MS);
      startBottleSpin();
      setLoading(true);

      try {
        const res = await fetch(`${apiBase}/api/suggest-sauces`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ term: trimmed, experimental: experimentalMode }),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (searchAbortRef.current !== controller) return;
        if (!res.ok) {
          setError(data.error || "Please try a different search term");
          setSelectedFood(null);
        } else {
          writeClientSuggestion(trimmed, experimentalMode, data);
          setSelectedFood({
            ...data,
            suggestions: experimentalMode
              ? tagExperimentalSuggestions(data.suggestions)
              : data.suggestions,
          });
          setError("");
        }
      } catch (e) {
        if (searchAbortRef.current !== controller) return;
        if (e.name === "AbortError") {
          setError("Search took too long. Please try again.");
        } else {
          setError("An error occurred while searching. Is the API running?");
        }
        setSelectedFood(null);
      } finally {
        clearTimeout(timeoutId);
        if (searchAbortRef.current === controller) {
          searchAbortRef.current = null;
          setLoading(false);
          stopBottleSpin();
        }
      }
    },
    [startBottleSpin, stopBottleSpin, experimentalMode]
  );

  const prevExperimentalModeRef = useRef(experimentalMode);
  useEffect(() => {
    if (prevExperimentalModeRef.current === experimentalMode) return;
    prevExperimentalModeRef.current = experimentalMode;
    if (searchTerm) handleSearch(searchTerm);
  }, [experimentalMode, handleSearch, searchTerm]);

  const handleSauceClick = useCallback((sauce) => {
    setSelectedSauce(sauce);
  }, []);

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError("");
    setAuthNotice(null);
    if (!authEmail.trim() || !authPassword) {
      setAuthError("Please enter email and password.");
      return;
    }
    setAuthSubmitting(true);
    try {
      if (authTab === "signup") {
        const data = await signUp(authEmail.trim(), authPassword, {
          full_name: authName.trim() || undefined,
        });
        if (data?.user && !data?.session) {
          setAuthNotice(
            "Account created. Check your email to confirm, then sign in here."
          );
          setAuthPassword("");
          setAuthName("");
          setAuthTab("signin");
        } else {
          setAuthModalOpen(false);
          setAuthEmail("");
          setAuthPassword("");
          setAuthName("");
        }
      } else {
        await signIn(authEmail.trim(), authPassword);
        setAuthModalOpen(false);
        setAuthEmail("");
        setAuthPassword("");
      }
    } catch (err) {
      setAuthError(err.message || "Sign in failed. Please try again.");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const openAuthModal = useCallback((tab) => {
    setAuthTab(tab);
    setAuthError("");
    setAuthNotice(null);
    setAuthModalOpen(true);
  }, []);

  const handleProfileSave = async (e) => {
    e.preventDefault();
    setAccountError("");
    setAccountNotice("");
    if (!user) {
      setAccountError("Sign in to update your profile.");
      return;
    }
    setAccountSubmitting(true);
    try {
      await updateProfile({ full_name: profileName.trim() });
      setAccountNotice("Profile updated.");
    } catch (err) {
      setAccountError(err.message || "Could not update profile.");
    } finally {
      setAccountSubmitting(false);
    }
  };

  const handlePasswordSave = async (e) => {
    e.preventDefault();
    setAccountError("");
    setAccountNotice("");
    if (!user) {
      setAccountError("Sign in to change your password.");
      return;
    }
    if (newPassword.length < 6) {
      setAccountError("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setAccountError("Passwords do not match.");
      return;
    }
    setAccountSubmitting(true);
    try {
      await updatePassword(newPassword);
      setAccountNotice("Password updated.");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setAccountError(err.message || "Could not update password.");
    } finally {
      setAccountSubmitting(false);
    }
  };

  const openDrawer = useCallback((tab = "saved") => {
    setDrawerTab(tab);
    setAccountError("");
    setAccountNotice("");
    setDrawerOpen(true);
  }, []);

  const handleViewSavedSauce = useCallback((sauce) => {
    setSelectedSauce({
      name: sauce.name,
      description: sauce.description,
      type: sauce.type,
      recipe: sauce.recipe,
    });
    setDrawerOpen(false);
  }, []);

  return (
    <>
      <div className="min-h-screen p-4 relative bg-black">
        {experimentalMode && (
          <div
            className="experimental-particle-layer pointer-events-none fixed inset-0 z-[1] overflow-hidden"
            aria-hidden="true"
          >
            {typingParticles.map((particle) => {
              if (particle.kind === "firework") {
                const size = particle.size || 260;
                return (
                  <span
                    key={particle.id}
                    className="experimental-firework"
                    style={{
                      left: particle.burstX,
                      top: particle.burstY,
                      "--particle-color": particle.color,
                      "--launch-dx": `${particle.launchX - particle.burstX}px`,
                      "--launch-dy": `${particle.launchY - particle.burstY}px`,
                      "--rocket-duration": `${particle.rocketDuration}s`,
                      "--burst-duration": `${particle.burstDuration}s`,
                      "--wave": `${particle.wave || 40}px`,
                      animationDelay: `${particle.delay}s`,
                    }}
                  >
                    <svg
                      className={`experimental-firework-rocket is-${particle.style || "space"}`}
                      width="64"
                      height="64"
                      viewBox="0 0 64 64"
                      aria-hidden="true"
                      style={{ animationDelay: `${particle.delay}s` }}
                    >
                      <path
                        d={particle.rocket}
                        fill="none"
                        stroke={particle.color}
                        strokeWidth="5.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <svg
                      className="experimental-firework-burst"
                      width={size}
                      height={size}
                      viewBox={`0 0 ${size} ${size}`}
                      aria-hidden="true"
                      style={{
                        marginLeft: -size / 2,
                        marginTop: -size / 2,
                      }}
                    >
                      {(particle.rays || []).map((ray, idx) => (
                        <path
                          key={`${particle.id}-ray-${idx}`}
                          d={ray.d}
                          fill="none"
                          stroke={particle.color}
                          strokeWidth={ray.strokeWidth}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          pathLength="1"
                          className="experimental-firework-ray"
                          style={{
                            animationDelay: `${(particle.delay || 0) + (particle.splitAt || particle.rocketDuration * 0.56) + (ray.delay || 0)}s`,
                          }}
                        />
                      ))}
                    </svg>
                  </span>
                );
              }
              if (particle.kind === "swirl") {
                const size = particle.size;
                return (
                  <span
                    key={particle.id}
                    className="experimental-swirl-orbit"
                    style={{
                      left: particle.x,
                      top: particle.y,
                      width: size,
                      height: size,
                      marginLeft: -size / 2,
                      marginTop: -size / 2,
                      "--spin-duration": `${particle.spinDuration}s`,
                      "--spin-dir": particle.dir,
                      "--particle-color": particle.color,
                      animationDelay: `${particle.delay}s`,
                    }}
                  >
                    <svg
                      className="experimental-swirl-trail"
                      width={size}
                      height={size}
                      viewBox={`0 0 ${size} ${size}`}
                      aria-hidden="true"
                    >
                      {(particle.arms || []).map((arm, idx) => (
                        <path
                          key={`${particle.id}-arm-${idx}`}
                          d={arm.d}
                          fill="none"
                          stroke={particle.color}
                          strokeWidth={arm.strokeWidth}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          pathLength="1"
                          className={`experimental-swirl-arm${arm.isBranch ? " is-branch" : ""}`}
                          style={{
                            animationDelay: `${(particle.delay || 0) + (arm.delay || 0)}s`,
                          }}
                        />
                      ))}
                    </svg>
                  </span>
                );
              }
              if (particle.kind === "flow") {
                return (
                  <span
                    key={particle.id}
                    className="experimental-flow"
                    style={{
                      left: particle.x,
                      top: particle.y,
                      width: particle.width,
                      height: particle.height,
                      "--particle-color": particle.color,
                      "--dx": `${particle.dx}px`,
                      "--dy": `${particle.dy}px`,
                      "--wave": `${particle.wave}px`,
                      "--particle-duration": `${particle.duration}s`,
                      animationDelay: `${particle.delay}s`,
                    }}
                  />
                );
              }
              return (
                <span
                  key={particle.id}
                  className="experimental-ribbon"
                  style={{
                    left: particle.x,
                    top: particle.y,
                    width: particle.width,
                    height: particle.height,
                    "--particle-color": particle.color,
                    "--dx": `${particle.dx}px`,
                    "--dy": `${particle.dy}px`,
                    "--wave": `${particle.wave}px`,
                    "--twist": `${particle.twist}deg`,
                    "--particle-duration": `${particle.duration}s`,
                    animationDelay: `${particle.delay}s`,
                  }}
                />
              );
            })}
          </div>
        )}

        <div className="relative z-20 isolate">
        <div className="max-w-4xl mx-auto mb-2 relative flex min-h-[40px] flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              if (menuSpinTimerRef.current) {
                clearTimeout(menuSpinTimerRef.current);
                menuSpinTimerRef.current = null;
              }
              setMenuSpinning(false);
              requestAnimationFrame(() => setMenuSpinning(true));
              menuSpinTimerRef.current = setTimeout(() => {
                setMenuSpinning(false);
                menuSpinTimerRef.current = null;
              }, 600);
              if (drawerOpen) {
                setDrawerOpen(false);
              } else {
                openDrawer("saved");
              }
            }}
            aria-expanded={drawerOpen}
            aria-controls="account-drawer"
            aria-label={drawerOpen ? "Close menu" : "Open menu"}
            className="group inline-flex h-12 w-12 items-center justify-center rounded-full p-1 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <img
              src={menuIcon}
              alt=""
              aria-hidden="true"
              className={`h-9 w-9 select-none ${menuSpinning ? "animate-spin-once" : ""}`}
              draggable="false"
            />
          </button>

          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <ExperimentalModeToggle
              enabled={experimentalMode}
              onChange={setExperimentalMode}
            />
          </div>

        <div className="flex min-h-[40px] flex-wrap items-center justify-end gap-2">
          {authLoading && isAuthEnabled && (
            <span className="font-roboto text-sm text-gray-500">Checking…</span>
          )}
          {!authLoading && isAuthEnabled && user && (
            <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
              <span className="max-w-[200px] truncate font-roboto text-sm text-gray-300 sm:max-w-xs">
                {user.email}
              </span>
              <button
                type="button"
                onClick={() => signOut()}
                className="rounded-lg bg-gray-700 px-3 py-2 font-roboto text-sm text-white transition hover:bg-gray-600"
              >
                Sign out
              </button>
            </div>
          )}
          {!authLoading && isAuthEnabled && !user && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openAuthModal("signin")}
                className="rounded-lg bg-white px-3 py-2 font-roboto text-sm font-medium text-black transition hover:bg-gray-200"
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => openAuthModal("signup")}
                className="rounded-lg border border-gray-300 px-3 py-2 font-roboto text-sm font-medium text-white transition hover:bg-white/10"
              >
                Sign up
              </button>
            </div>
          )}
          {!authLoading && !isAuthEnabled && (
            <button
              type="button"
              onClick={() => {
                setAuthError("");
                setAuthNotice(null);
                setAuthModalOpen(true);
              }}
              className="rounded-lg border border-gray-500 px-3 py-2 font-roboto text-sm text-gray-300 transition hover:border-gray-400 hover:text-white"
            >
              Account
            </button>
          )}
        </div>
        </div>

        <div
          className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-500 ${
            drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />

        <aside
          id="account-drawer"
          className={`fixed left-0 top-0 z-50 h-full w-[88vw] max-w-sm bg-white shadow-2xl transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            drawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
          aria-hidden={!drawerOpen}
          role="dialog"
          aria-label="Saved sauces and account settings"
        >
          <div className="flex items-center justify-between border-b border-gray-200 p-4">
            <h2 className="font-roboto text-lg font-bold text-black">Your menu</h2>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="text-2xl leading-none text-gray-500 hover:text-black"
              aria-label="Close menu"
            >
              ×
            </button>
          </div>

          <div className="flex border-b border-gray-200">
            <button
              type="button"
              onClick={() => {
                setDrawerTab("saved");
                setAccountError("");
                setAccountNotice("");
              }}
              className={`flex-1 py-3 font-roboto text-sm font-medium ${
                drawerTab === "saved"
                  ? "border-b-2 border-black text-black"
                  : "text-gray-500 hover:text-black"
              }`}
            >
              Saved sauces
            </button>
            <button
              type="button"
              onClick={() => {
                setDrawerTab("account");
                setAccountError("");
                setAccountNotice("");
              }}
              className={`flex-1 py-3 font-roboto text-sm font-medium ${
                drawerTab === "account"
                  ? "border-b-2 border-black text-black"
                  : "text-gray-500 hover:text-black"
              }`}
            >
              Account
            </button>
          </div>

          <div className="h-[calc(100%-7.25rem)] overflow-y-auto p-4">
            {drawerTab === "saved" && (
              <div>
                {savedSauces.length === 0 ? (
                  <p className="font-roboto text-sm text-gray-600">
                    No saved sauces yet. Tap the bookmark on any sauce to save it here.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {savedSauces.map((sauce) => (
                      <li
                        key={sauce.name}
                        className="rounded-lg border border-gray-200 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="font-roboto text-base font-bold text-black">
                              {sauce.name}
                            </h3>
                            {sauce.type && (
                              <span className="mt-1 inline-block rounded-full bg-black px-2 py-0.5 font-roboto text-xs text-white">
                                {sauce.type}
                              </span>
                            )}
                            {sauce.food && (
                              <p className="mt-1 font-roboto text-xs text-gray-500">
                                Saved from: {sauce.food}
                              </p>
                            )}
                            {sauce.description && (
                              <p className="mt-2 font-roboto text-sm text-gray-700">
                                {sauce.description}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeSavedSauce(sauce.name)}
                            className="shrink-0 rounded-md border border-gray-300 px-2 py-1 font-roboto text-xs text-gray-700 hover:bg-gray-100"
                            aria-label={`Remove ${sauce.name} from saved`}
                          >
                            Remove
                          </button>
                        </div>
                        {sauce.recipe && (
                          <button
                            type="button"
                            onClick={() => handleViewSavedSauce(sauce)}
                            className="mt-3 inline-flex rounded-md bg-black px-3 py-1.5 font-roboto text-xs font-medium text-white hover:bg-gray-800"
                          >
                            View recipe
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {drawerTab === "account" && (
              <div className="space-y-6">
                {!isAuthEnabled && (
                  <p className="font-roboto text-sm text-gray-700">
                    Sign-in isn&apos;t configured for this app yet, so account
                    information can&apos;t be changed here. See the{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setDrawerOpen(false);
                        setAuthError("");
                        setAuthNotice(null);
                        setAuthModalOpen(true);
                      }}
                      className="font-medium text-black underline"
                    >
                      sign-in setup
                    </button>{" "}
                    for details.
                  </p>
                )}

                {isAuthEnabled && !user && (
                  <div className="space-y-3">
                    <p className="font-roboto text-sm text-gray-700">
                      Sign in to update your name, email, or password.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDrawerOpen(false);
                          openAuthModal("signin");
                        }}
                        className="rounded-lg bg-black px-3 py-2 font-roboto text-sm font-medium text-white hover:bg-gray-800"
                      >
                        Sign in
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDrawerOpen(false);
                          openAuthModal("signup");
                        }}
                        className="rounded-lg border border-gray-300 px-3 py-2 font-roboto text-sm font-medium text-black hover:bg-gray-100"
                      >
                        Sign up
                      </button>
                    </div>
                  </div>
                )}

                {isAuthEnabled && user && (
                  <>
                    <div className="rounded-lg bg-gray-100 p-3">
                      <p className="font-roboto text-xs uppercase tracking-wide text-gray-500">
                        Signed in as
                      </p>
                      <p className="break-all font-roboto text-sm font-medium text-black">
                        {user.email}
                      </p>
                    </div>

                    {accountNotice && (
                      <p
                        role="status"
                        className="rounded-lg border border-green-200 bg-green-50 p-3 font-roboto text-sm text-green-700"
                      >
                        {accountNotice}
                      </p>
                    )}
                    {accountError && (
                      <p
                        role="alert"
                        className="rounded-lg border border-red-200 bg-red-50 p-3 font-roboto text-sm text-red-700"
                      >
                        {accountError}
                      </p>
                    )}

                    <form onSubmit={handleProfileSave} className="space-y-3">
                      <div>
                        <label
                          htmlFor="profile-name"
                          className="mb-1 block font-roboto text-sm text-gray-700"
                        >
                          Display name
                        </label>
                        <input
                          id="profile-name"
                          type="text"
                          value={profileName}
                          onChange={(e) => setProfileName(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 p-3 font-roboto"
                          placeholder="Your name"
                          autoComplete="name"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={accountSubmitting}
                        className="w-full rounded-lg bg-black py-2.5 font-roboto text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
                      >
                        {accountSubmitting ? "Saving…" : "Save profile"}
                      </button>
                    </form>

                    <form onSubmit={handlePasswordSave} className="space-y-3">
                      <div>
                        <label
                          htmlFor="new-password"
                          className="mb-1 block font-roboto text-sm text-gray-700"
                        >
                          New password
                        </label>
                        <input
                          id="new-password"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 p-3 font-roboto"
                          placeholder="••••••••"
                          minLength={6}
                          autoComplete="new-password"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="confirm-password"
                          className="mb-1 block font-roboto text-sm text-gray-700"
                        >
                          Confirm new password
                        </label>
                        <input
                          id="confirm-password"
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 p-3 font-roboto"
                          placeholder="••••••••"
                          minLength={6}
                          autoComplete="new-password"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={
                          accountSubmitting || !newPassword || !confirmPassword
                        }
                        className="w-full rounded-lg border border-gray-300 py-2.5 font-roboto text-sm font-semibold text-black hover:bg-gray-100 disabled:opacity-50"
                      >
                        {accountSubmitting ? "Saving…" : "Update password"}
                      </button>
                    </form>

                    <button
                      type="button"
                      onClick={async () => {
                        await signOut();
                        setDrawerOpen(false);
                      }}
                      className="w-full rounded-lg bg-gray-200 py-2.5 font-roboto text-sm font-medium text-gray-800 hover:bg-gray-300"
                    >
                      Sign out
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </aside>

        {authModalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
            onClick={() => !authSubmitting && setAuthModalOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-modal-title"
          >
            <div
              className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-4">
                <h2 id="auth-modal-title" className="text-xl font-bold font-roboto text-black">
                  {!isAuthEnabled
                    ? "Enable sign-in"
                    : authTab === "signin"
                      ? "Sign in"
                      : "Create account"}
                </h2>
                <button
                  type="button"
                  onClick={() => !authSubmitting && setAuthModalOpen(false)}
                  className="text-gray-500 hover:text-black text-2xl leading-none"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              {!isAuthEnabled ? (
                <div className="space-y-3 font-roboto text-gray-700 text-sm">
                  <p>
                    Sign-in uses Supabase (email and password). Add these to your
                    environment and rebuild the app:
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      <code className="text-xs bg-gray-100 px-1 rounded">VITE_SUPABASE_URL</code>
                    </li>
                    <li>
                      <code className="text-xs bg-gray-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code>
                    </li>
                  </ul>
                  <p>
                    On <strong>Render</strong>: add them to your <strong>static site</strong> (not the API) →
                    Environment, then <strong>Manual Deploy → Clear build cache & deploy</strong> so
                    Vite bakes them into the build.
                  </p>
                  <p>
                    Create a free project at{" "}
                    <a
                      href="https://supabase.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-black underline font-medium"
                    >
                      supabase.com
                    </a>
                    , then copy the project URL and anon key from{" "}
                    <strong>Project Settings → API</strong>. Enable the Email
                    provider under <strong>Authentication → Providers</strong>.
                  </p>
                </div>
              ) : (
                <>
              <div className="flex border-b border-gray-200 mb-4">
                <button
                  type="button"
                  className={`flex-1 py-2 font-roboto text-sm font-medium ${authTab === "signin" ? "border-b-2 border-black text-black" : "text-gray-500"}`}
                  onClick={() => { setAuthTab("signin"); setAuthError(""); setAuthNotice(null); }}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className={`flex-1 py-2 font-roboto text-sm font-medium ${authTab === "signup" ? "border-b-2 border-black text-black" : "text-gray-500"}`}
                  onClick={() => { setAuthTab("signup"); setAuthError(""); setAuthNotice(null); }}
                >
                  Sign up
                </button>
              </div>
              <form onSubmit={handleAuthSubmit} className="space-y-3">
                {authTab === "signup" && (
                  <div>
                    <label htmlFor="auth-name" className="block text-sm font-roboto text-gray-700 mb-1">Name (optional)</label>
                    <input
                      id="auth-name"
                      type="text"
                      value={authName}
                      onChange={(e) => setAuthName(e.target.value)}
                      className="w-full p-3 border border-gray-300 rounded-lg font-roboto"
                      placeholder="Your name"
                      autoComplete="name"
                    />
                  </div>
                )}
                <div>
                  <label htmlFor="auth-email" className="block text-sm font-roboto text-gray-700 mb-1">Email</label>
                  <input
                    id="auth-email"
                    type="email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg font-roboto"
                    placeholder="you@example.com"
                    required
                    autoComplete="email"
                  />
                </div>
                <div>
                  <label htmlFor="auth-password" className="block text-sm font-roboto text-gray-700 mb-1">Password</label>
                  <input
                    id="auth-password"
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg font-roboto"
                    placeholder="••••••••"
                    required
                    minLength={6}
                    autoComplete={authTab === "signin" ? "current-password" : "new-password"}
                  />
                  {authTab === "signup" && (
                    <p className="text-xs text-gray-500 font-roboto mt-1">At least 6 characters</p>
                  )}
                </div>
                {authNotice && (
                  <p className="text-sm text-green-700 font-roboto bg-green-50 border border-green-200 rounded-lg p-3" role="status">
                    {authNotice}
                  </p>
                )}
                {authError && (
                  <p className="text-sm text-red-600 font-roboto" role="alert">{authError}</p>
                )}
                <button
                  type="submit"
                  disabled={authSubmitting}
                  className="w-full py-3 bg-black text-white font-roboto font-semibold rounded-lg hover:bg-gray-800 disabled:opacity-50 transition"
                >
                  {authSubmitting ? "Please wait…" : authTab === "signin" ? "Sign in" : "Sign up"}
                </button>
              </form>
                </>
              )}
            </div>
          </div>
        )}

        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <img
              src="/logo.png"
              alt="SauceMate Logo"
              className="w-48 h-48 mx-auto mb-4"
            />
            <p className="text-lg text-gray-300 font-roboto">
              Find the perfect sauce for your food!
            </p>
            <p
              className={`text-sm font-roboto mt-2 transition-colors duration-300 ${
                experimentalMode ? "text-violet-300" : "text-gray-400"
              }`}
            >
              {experimentalMode
                ? "Every letter animates — A–I gold swirl · J–Q burgundy flow · R–Z purple ribbon · space & E/S/D/T/Y/N/G rocket firework"
                : "Try our experimental pairings for unique flavor combinations!"}
            </p>
          </div>

          <form
            className={`relative z-30 rounded-lg shadow-lg p-6 mb-8 transition-all duration-300 bg-white ${
              experimentalMode
                ? "ring-2 ring-violet-500/30 shadow-violet-500/10"
                : ""
            }`}
            onSubmit={(e) => {
              e.preventDefault();
              handleSearch(searchInput);
            }}
          >
            <label htmlFor="food-search" className="sr-only">
              What food are you eating?
            </label>
            <div className="flex gap-2 mb-2">
              <input
                id="food-search"
                ref={searchInputRef}
                type="text"
                placeholder="e.g. fries, wings, samosa, or 'experimental'"
                className="flex-1 p-4 border border-gray-300 rounded-lg text-lg font-roboto bg-gray-50 focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent outline-none transition"
                value={searchInput}
                onChange={handleSearchInputChange}
                onKeyDown={handleSearchKeyDown}
                name="food-search"
                autoComplete="off"
                aria-label="Search for a food to get sauce recommendations"
                aria-describedby={error ? "search-error" : undefined}
              />
              <button
                type="submit"
                disabled={loading || !searchInput.trim()}
                className="px-6 py-4 bg-black text-white font-roboto font-semibold rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                Find sauces
              </button>
            </div>
            {error && (
              <p id="search-error" className="text-red-500 mb-2 font-roboto" role="alert">
                {error}
              </p>
            )}
            {searchInput.trim() && autocompleteMatches.length > 0 && (
              <ul className="bg-gray-100 rounded-lg overflow-hidden" role="listbox">
                {autocompleteMatches.slice(0, 8).map((key) => (
                  <li
                    key={key}
                    role="option"
                    className="p-3 hover:bg-gray-200 cursor-pointer font-roboto border-b border-gray-200 last:border-0"
                    onClick={() => handleSearch(keyToDisplayName(key))}
                  >
                    {keyToDisplayName(key)}
                  </li>
                ))}
              </ul>
            )}
          </form>

          {bottleSpinning && (
            <div className="bg-white rounded-lg shadow-lg p-6 mb-8" role="status">
              <div className="flex flex-col items-center justify-center gap-3">
                <SpinningBottle visible className="" />
                <p className="text-lg text-gray-700 font-roboto">
                  Finding sauce suggestions...
                </p>
              </div>
            </div>
          )}

          {searchTerm &&
            searchInput.trim().toLowerCase() === searchTerm &&
            !selectedFood &&
            !loading &&
            !bottleSpinning &&
            !error && (
            <div className="bg-white rounded-lg shadow-lg p-6 mb-8 text-center">
              <p className="text-gray-600 font-roboto">
                No sauces found for <strong>{keyToDisplayName(searchTerm.replace(/\s+/g, " "))}</strong>. Try a suggestion above or use &quot;Find sauces&quot; to search the web.
              </p>
            </div>
          )}

          {searchTerm &&
            selectedFood &&
            displayedSuggestions.length > 0 &&
            !bottleSpinning && (
              <div
                className={`rounded-lg shadow-lg p-6 transition-all duration-300 ${
                  experimentalMode
                    ? "bg-white ring-2 ring-violet-500/25 shadow-violet-500/10"
                    : "bg-white"
                }`}
              >
                <h2 className="text-2xl font-bold mb-4 text-black font-roboto flex flex-wrap items-center gap-2">
                  {searchTerm.toLowerCase() === "experimental"
                    ? "Experimental pairings"
                    : `Sauces for ${keyToDisplayName(searchTerm.replace(/\s+/g, " "))}`}
                  {experimentalMode && (
                    <span className="inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-700">
                      Experimental
                    </span>
                  )}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {displayedSuggestions.map((item, index) => {
                    const saved = isSauceSaved(item);
                    return (
                      <div
                        key={index}
                        className={`relative rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer ${
                          item.experimental
                            ? "bg-violet-50 ring-1 ring-violet-200"
                            : "bg-gray-100"
                        }`}
                        onClick={() => handleSauceClick(item)}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSavedSauce(
                              item,
                              keyToDisplayName(searchTerm.replace(/\s+/g, " "))
                            );
                          }}
                          aria-pressed={saved}
                          aria-label={saved ? `Unsave ${item.name}` : `Save ${item.name}`}
                          title={saved ? "Saved — click to remove" : "Save sauce"}
                          className={`absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full transition ${
                            saved
                              ? "bg-black text-white"
                              : "border border-gray-300 bg-white text-gray-500 hover:text-black"
                          }`}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill={saved ? "currentColor" : "none"}
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-4 w-4"
                            aria-hidden="true"
                          >
                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                          </svg>
                        </button>
                        <h3 className="text-xl font-bold mb-2 pr-10 text-black font-roboto">
                          {item.name}
                          {item.experimental && (
                            <span className="ml-2 inline-block text-xs font-semibold uppercase tracking-wide text-violet-600">
                              New
                            </span>
                          )}
                        </h3>
                        <p className="text-gray-700 font-roboto">
                          {item.description}
                        </p>
                        <span className="inline-block mt-2 px-3 py-1 bg-black text-white rounded-full text-sm font-roboto">
                          {item.type}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          {selectedSauce && (
            <div className="bg-white rounded-lg shadow-lg p-6 mt-6 relative">
              <button
                type="button"
                onClick={() => setSelectedSauce(null)}
                className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold transition"
                aria-label="Close recipe"
              >
                ×
              </button>
              <h2 className="text-2xl font-bold mb-4 text-black font-roboto pr-12">
                {selectedSauce.name} — Recipe
              </h2>
              <p className="text-lg text-gray-700 font-roboto whitespace-pre-line">
                {selectedSauce.recipe}
              </p>
            </div>
          )}
        </div>
        </div>
        <img
          src="https://ucarecdn.com/7fbf9d98-9e6a-40fa-a046-2642f54bfc6c/-/format/auto/"
          alt="Watermark"
          className="fixed bottom-4 right-4 w-16 h-16 opacity-50 z-20"
        />
      </div>
    </>
  );
}

export default MainComponent;
