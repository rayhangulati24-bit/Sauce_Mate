/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        roboto: ["Roboto", "system-ui", "sans-serif"],
      },
      keyframes: {
        "spin-once": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        "experimental-glow": {
          "0%, 100%": { opacity: "0.4", transform: "scale(1)" },
          "50%": { opacity: "0.8", transform: "scale(1.15)" },
        },
      },
      animation: {
        "spin-once": "spin-once 0.6s ease-in-out",
        "experimental-glow": "experimental-glow 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
