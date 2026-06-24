import React, { useRef } from "react";

export default function ExperimentalModeToggle({ enabled, onChange }) {
  const pulseRef = useRef(null);

  const handleToggle = () => {
    if (pulseRef.current) {
      pulseRef.current.classList.remove("experimental-pulse");
      void pulseRef.current.offsetWidth;
      pulseRef.current.classList.add("experimental-pulse");
    }
    onChange(!enabled);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Experimental mode"
      onClick={handleToggle}
      className={`group relative inline-flex items-center gap-2 rounded-full border px-2 py-1 font-roboto text-xs font-medium transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80 sm:gap-2.5 sm:px-3 sm:py-1.5 sm:text-sm ${
        enabled
          ? "border-violet-500/60 bg-violet-950/80 text-violet-200 shadow-[0_0_20px_rgba(139,92,246,0.35)]"
          : "border-gray-700 bg-gray-900/60 text-gray-400 hover:border-gray-600 hover:text-gray-300"
      }`}
    >
      <span
        ref={pulseRef}
        className={`hidden select-none transition-colors duration-300 sm:inline ${
          enabled ? "text-violet-300" : ""
        }`}
      >
        Experimental
      </span>

      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-300 ease-out ${
          enabled ? "bg-violet-500" : "bg-gray-600"
        }`}
        aria-hidden="true"
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
            enabled ? "translate-x-[18px]" : "translate-x-[3px]"
          }`}
        />
        {enabled && (
          <span className="absolute inset-0 rounded-full bg-violet-400/40 animate-experimental-glow" />
        )}
      </span>
    </button>
  );
}
