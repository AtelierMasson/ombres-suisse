import { defineConfig } from "vite";

// base relative : le site peut être publié tel quel dans un sous-dossier (GitHub Pages, Cloudflare Pages…)
export default defineConfig({ base: "./", server: { port: 5199 } });
