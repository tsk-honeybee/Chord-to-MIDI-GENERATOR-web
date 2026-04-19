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
      registerType: "prompt",
      pwaAssets: {
        disabled: true,
      },
      includeAssets: ["audio/piano-c3.ogg", "apple-touch-icon.png", "favicon-32.png", "favicon-192.png"],
      manifest: {
        name: "Chord to MIDI Generator",
        short_name: "ChordMIDI",
        description: "Create chord charts, shape voicings, and export MIDI directly from a responsive offline-ready web app.",
        theme_color: "#d56d3a",
        background_color: "#f5ede0",
        display: "standalone",
        start_url: base,
        scope: base,
        id: base,
        icons: [
          {
            src: `${base}pwa-192x192.png`,
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: `${base}pwa-512x512.png`,
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: `${base}maskable-icon-512x512.png`,
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        related_applications: [
          {
            platform: "webapp",
            url: `${base}manifest.webmanifest`,
            id: base,
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico,json,ogg,mp3,wav}"],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: true,
      },
    })
  ]
});
