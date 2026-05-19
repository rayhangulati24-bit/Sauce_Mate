import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";

import { useAuth } from "../contexts/AuthContext";
import { foodDatabase } from "../data/foodDatabase";
import SpinningBottle from "./SpinningBottle";

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

function MainComponent() {
  const { user, loading: authLoading, signIn, signUp, signOut, isAuthEnabled } = useAuth();
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
    };
  }, []);

  // Autocomplete: filter local suggestions as user types (no API calls)
  const autocompleteMatches = useMemo(() => {
    if (!searchInput.trim()) return [];
    const searchWords = searchInput.toLowerCase().split(/\s+/).join("");
    return Object.keys(foodDatabase).filter((key) =>
      key.toLowerCase().includes(searchWords)
    );
  }, [searchInput]);


  const handleSearch = useCallback(
    async (term) => {
      const trimmed = term.trim();
      if (!trimmed) return;

      setSearchInput(trimmed);
      setSearchTerm(trimmed.toLowerCase());
      setSelectedSauce(null);

      if (trimmed.toLowerCase() === "rayhan gulati") {
        startBottleSpin(2000);
        setError("He is the creator of this app!");
        setSelectedFood(null);
        return;
      }

      setError("");
      const searchWords = trimmed.toLowerCase().split(/\s+/).join("");
      const matches = Object.keys(foodDatabase).filter((key) =>
        key.toLowerCase().includes(searchWords)
      );

      if (matches.length > 0) {
        startBottleSpin(2000);
        setError("");
        const fuzzyMatch = matches[0];
        setSelectedFood(foodDatabase[fuzzyMatch]);
      } else {
        startBottleSpin();
        setLoading(true);
        const apiBase = getApiBaseUrl();
        if (apiBase === null) {
          stopBottleSpin();
          setError(
            "AI search is not configured. Set VITE_API_URL on your static site to your API URL (see DEPLOY-RENDER.md)."
          );
          setSelectedFood(null);
          setLoading(false);
          return;
        }
        try {
          const res = await fetch(`${apiBase}/api/suggest-sauces`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ term: trimmed }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            setError(data.error || "Please try a different search term");
            setSelectedFood(null);
          } else {
            setSelectedFood(data);
            setError("");
          }
        } catch {
          setError("An error occurred while searching. Is the API running?");
          setSelectedFood(null);
        }
        setLoading(false);
        stopBottleSpin();
      }
    },
    [startBottleSpin, stopBottleSpin]
  );

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

  return (
    <>
      <div className="min-h-screen bg-black p-4 relative">
        <div className="max-w-4xl mx-auto mb-2 flex min-h-[40px] flex-wrap items-center justify-end gap-2">
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
              src="https://ucarecdn.com/83becc3f-d939-44ed-97c2-1a28578677a1/-/format/auto/"
              alt="SauceMate Logo"
              className="w-48 h-48 mx-auto mb-4"
            />
            <p className="text-lg text-gray-300 font-roboto">
              Find the perfect sauce for your food!
            </p>
            <p className="text-sm text-gray-400 font-roboto mt-2">
              Try our experimental pairings for unique flavor combinations!
            </p>
          </div>

          <form
            className="bg-white rounded-lg shadow-lg p-6 mb-8"
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
                type="text"
                placeholder="e.g. fries, wings, samosa, or 'experimental'"
                className="flex-1 p-4 border border-gray-300 rounded-lg text-lg font-roboto bg-gray-50 focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent outline-none transition"
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  if (error) setError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.form?.requestSubmit()}
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

          {searchTerm && !selectedFood && !loading && !bottleSpinning && !error && (
            <div className="bg-white rounded-lg shadow-lg p-6 mb-8 text-center">
              <p className="text-gray-600 font-roboto">
                No sauces found for <strong>{keyToDisplayName(searchTerm.replace(/\s+/g, " "))}</strong>. Try a suggestion above or use &quot;Find sauces&quot; to search the web.
              </p>
            </div>
          )}

          {searchTerm &&
            selectedFood &&
            selectedFood.suggestions &&
            !bottleSpinning && (
              <div className="bg-white rounded-lg shadow-lg p-6">
                <h2 className="text-2xl font-bold mb-4 text-black font-roboto">
                  {searchTerm.toLowerCase() === "experimental"
                    ? "Experimental pairings"
                    : `Sauces for ${keyToDisplayName(searchTerm.replace(/\s+/g, " "))}`}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {selectedFood.suggestions.map((item, index) => (
                    <div
                      key={index}
                      className="bg-gray-100 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                      onClick={() => handleSauceClick(item)}
                    >
                      <h3 className="text-xl font-bold mb-2 text-black font-roboto">
                        {item.name}
                      </h3>
                      <p className="text-gray-700 font-roboto">
                        {item.description}
                      </p>
                      <span className="inline-block mt-2 px-3 py-1 bg-black text-white rounded-full text-sm font-roboto">
                        {item.type}
                      </span>
                    </div>
                  ))}
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
        <img
          src="https://ucarecdn.com/7fbf9d98-9e6a-40fa-a046-2642f54bfc6c/-/format/auto/"
          alt="Watermark"
          className="fixed bottom-4 right-4 w-16 h-16 opacity-50"
        />
      </div>
    </>
  );
}

export default MainComponent;
