"use client";
import React, { useState, useCallback, useMemo } from "react";

import { useHandleStreamResponse } from "../utilities/runtime-helpers";
import { foodDatabase } from "../data/foodDatabase";

/** Convert a key like "fishFingers" to "Fish Fingers" */
function keyToDisplayName(key) {
  return key.replace(/([A-Z])/g, " $1").trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

function MainComponent() {
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFood, setSelectedFood] = useState(null);
  const [selectedSauce, setSelectedSauce] = useState(null);
  const [loading, setLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");

  const handleStreamResponse = useHandleStreamResponse({
    onChunk: useCallback((chunk) => {
      setStreamingMessage(chunk);
      setIsGenerating(true);
    }, []),
    onFinish: useCallback((message) => {
      try {
        const parsed = JSON.parse(message);
        setSelectedFood(parsed);
        setStreamingMessage("");
        setIsGenerating(false);
      } catch (e) {
        console.error(e);
        setIsGenerating(false);
      }
    }, []),
  });

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
        setError("");
        const fuzzyMatch = matches[0];
        setSelectedFood(foodDatabase[fuzzyMatch]);
      } else {
        setLoading(true);
        const apiUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, "");
        if (apiUrl) {
          try {
            const res = await fetch(`${apiUrl}/api/suggest-sauces`, {
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
          } catch (err) {
            setError("An error occurred while searching");
            setSelectedFood(null);
          }
          setLoading(false);
          return;
        }
        try {
          const [scrapingResponse, chatResponse] = await Promise.all([
            fetch("/integrations/web-scraping/post", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                url: `https://www.allrecipes.com/search?q=${encodeURIComponent(
                  term
                )}+sauce`,
                getText: true,
              }),
            }),
            fetch("/integrations/chat-gpt/conversationgpt4", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                messages: [
                  {
                    role: "system",
                    content:
                      "You are a helpful assistant that suggests food pairings. If the user's input contains inappropriate, offensive, or adult content, respond with null. Otherwise, provide sauce suggestions.",
                  },
                  {
                    role: "user",
                    content: `Suggest 3-4 sauce or condiment pairings for ${term}. Format as JSON array of objects with name, description (short), type (sauce/dip), and recipe (detailed) fields.`,
                  },
                ],
                json_schema: {
                  name: "sauce_suggestions",
                  schema: {
                    type: "object",
                    properties: {
                      suggestions: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            description: { type: "string" },
                            type: { type: "string" },
                            recipe: { type: "string" },
                          },
                          required: ["name", "description", "type", "recipe"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["suggestions"],
                    additionalProperties: false,
                  },
                },
                stream: true,
              }),
            }),
          ]);

          if (scrapingResponse.ok) {
            const text = await scrapingResponse.text();
            if (text && text.length > 0) {
              const recipes = text.match(
                /(?:sauce|dip|dressing).*?(?:ingredients|directions|instructions)/gi
              );
              if (recipes && recipes.length > 0) {
                const suggestions = recipes.slice(0, 3).map((recipe) => ({
                  name: recipe.split(/[.,]/)[0].trim(),
                  description: "Web recipe sauce pairing",
                  type: "sauce",
                  recipe: recipe.trim(),
                }));
                setSelectedFood({ suggestions });
                setLoading(false);
                return;
              }
            }
          }

          if (!chatResponse.ok) {
            setError("Please try a different search term");
            setSelectedFood(null);
          } else {
            setError("");
            handleStreamResponse(chatResponse);
          }
        } catch (err) {
          setError("An error occurred while searching");
          setSelectedFood(null);
        }
        setLoading(false);
      }
    },
    [handleStreamResponse]
  );

  const handleSauceClick = useCallback((sauce) => {
    setSelectedSauce(sauce);
  }, []);

  return (
    <>
      <div className="min-h-screen bg-black p-4 relative">
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
                disabled={loading || isGenerating || !searchInput.trim()}
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

          {(loading || isGenerating) && (
            <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
              <div className="flex items-center justify-center gap-3">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-gray-900" aria-hidden />
                <p className="text-lg text-gray-700 font-roboto">
                  {loading
                    ? "Finding sauce suggestions..."
                    : "Generating recommendations..."}
                </p>
              </div>
              {isGenerating && streamingMessage && (
                <pre className="mt-4 p-4 bg-gray-100 rounded-lg text-sm text-gray-600 font-mono overflow-auto max-h-32" aria-live="polite">
                  {streamingMessage.slice(-500)}
                </pre>
              )}
            </div>
          )}

          {searchTerm && !selectedFood && !loading && !isGenerating && !error && (
            <div className="bg-white rounded-lg shadow-lg p-6 mb-8 text-center">
              <p className="text-gray-600 font-roboto">
                No sauces found for <strong>{keyToDisplayName(searchTerm.replace(/\s+/g, " "))}</strong>. Try a suggestion above or use &quot;Find sauces&quot; to search the web.
              </p>
            </div>
          )}

          {searchTerm &&
            selectedFood &&
            selectedFood.suggestions &&
            !isGenerating && (
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
