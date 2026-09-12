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

/** Blend experimental pairings into a suggestion list when mode is on. */
function withExperimentalSuggestions(suggestions, experimentalMode) {
  if (!experimentalMode || !Array.isArray(suggestions)) return suggestions;
  const experimental = foodDatabase.experimentalPairings?.suggestions || [];
  const names = new Set(suggestions.map((s) => s.name?.toLowerCase()));
  const extras = experimental
    .filter((s) => !names.has(s.name?.toLowerCase()))
    .sort(() => Math.random() - 0.5)
    .slice(0, 2)
    .map((s) => ({ ...s, experimental: true }));
  return [...suggestions, ...extras];
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

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState("saved");
  const [savedSauces, setSavedSauces] = useState(() => readSavedSauces(null));
  const [menuSpinning, setMenuSpinning] = useState(false);
  const menuSpinTimerRef = useRef(null);
  const [experimentalMode, setExperimentalMode] = useState(readExperimentalMode);

  useEffect(() => {
    try {
      localStorage.setItem("saucemate:experimentalMode", String(experimentalMode));
    } catch (err) {
      console.error("Failed to persist experimental mode:", err);
    }
  }, [experimentalMode]);

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
        const food = foodDatabase[fuzzyMatch];
        setSelectedFood({
          ...food,
          suggestions: withExperimentalSuggestions(food.suggestions, experimentalMode),
        });
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
            body: JSON.stringify({ term: trimmed, experimental: experimentalMode }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            setError(data.error || "Please try a different search term");
            setSelectedFood(null);
          } else {
            setSelectedFood({
              ...data,
              suggestions: withExperimentalSuggestions(data.suggestions, experimentalMode),
            });
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
    [startBottleSpin, stopBottleSpin, experimentalMode]
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
      <div
        className={`min-h-screen p-4 relative transition-colors duration-500 ${
          experimentalMode
            ? "bg-gradient-to-b from-violet-950/40 via-black to-black"
            : "bg-black"
        }`}
      >
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
              src="https://ucarecdn.com/83becc3f-d939-44ed-97c2-1a28578677a1/-/format/auto/"
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
                ? "Experimental mode on — bold, unexpected pairings ahead!"
                : "Try our experimental pairings for unique flavor combinations!"}
            </p>
          </div>

          <form
            className={`rounded-lg shadow-lg p-6 mb-8 transition-all duration-300 ${
              experimentalMode
                ? "bg-white ring-2 ring-violet-500/30 shadow-violet-500/10"
                : "bg-white"
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
                  {selectedFood.suggestions.map((item, index) => {
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
