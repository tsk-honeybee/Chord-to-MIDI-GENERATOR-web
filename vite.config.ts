import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const repositoryName =
  process.env.GITHUB_REPOSITORY?.split("/")[1] || process.env.npm_package_name || "Chord-to-MIDI-GENERATOR-web";
const isGitHubPagesBuild = process.env.GITHUB_ACTIONS === "true";
const base = isGitHubPagesBuild ? `/${repositoryName}/` : "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Chord to MIDI Generator",
        short_name: "ChordMIDI",
        description: "Create chord charts, shape voicings, and export MIDI directly from a responsive offline-ready web app.",
        theme_color: "#d56d3a",
        background_color: "#f5ede0",
        display: "standalone",
        start_url: base
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico,json,ogg,mp3,wav}"],
        cleanupOutdatedCaches: true
      }
    })
  ]
});
