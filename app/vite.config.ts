import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

const shared = fileURLToPath(new URL("../supabase/functions/_shared", import.meta.url));

// BASE_PATH: "/agenda/" no GitHub Pages; "/" no resto.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  resolve: { alias: { "@shared": shared } },
  server: { fs: { allow: [".."] } },
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectManifest: { globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"] },
      manifest: {
        name: "Agenda",
        short_name: "Agenda",
        description: "Organizador semanal com IA",
        lang: "pt-BR",
        theme_color: "#0f766e",
        background_color: "#f7f7f5",
        display: "standalone",
        start_url: ".",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});
