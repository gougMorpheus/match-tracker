import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// Build-Kennung fuer die Update-Pruefung der App (public /version.json vs. eingebaute Kennung).
const appBuild = process.env.COMMIT_REF || process.env.VITE_APP_BUILD || `local-${Date.now()}`;

const versionFilePlugin = () => ({
  name: "match-tracker-version-file",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: appBuild }) });
    // Service Worker mit Build-Kennung (neuer Build => neuer Cache, alte werden geloescht).
    const sw = readFileSync(new URL("./src/pwa/sw.template.js", import.meta.url), "utf8").replaceAll("__APP_BUILD__", appBuild);
    this.emitFile({ type: "asset", fileName: "sw.js", source: sw });
  }
});

// Battle-Cal (hinter Schalter): statische Seite /battle-cal/ aus src/battle-cal/battle-cal.html.
// Supabase-URL und Publishable Key des Match-Trackers werden wie fuer die App aus VITE_* eingesetzt (nichts im Repo).
const battleCalPlugin = () => {
  let env = {};
  return {
    name: "match-tracker-battle-cal",
    configResolved(config) { env = config.env || {}; },
    generateBundle() {
      const url = String(env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
      const key = String(env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim();
      const html = readFileSync(new URL("./src/battle-cal/battle-cal.html", import.meta.url), "utf8")
        .replace('"__BC_SUPABASE_URL__"', () => JSON.stringify(url || "__BC_SUPABASE_URL__"))
        .replace('"__BC_SUPABASE_KEY__"', () => JSON.stringify(key || "__BC_SUPABASE_KEY__"));
      this.emitFile({ type: "asset", fileName: "battle-cal/index.html", source: html });
    }
  };
};

export default defineConfig({
  plugins: [react(), versionFilePlugin(), battleCalPlugin()],
  define: {
    "import.meta.env.VITE_APP_BUILD": JSON.stringify(appBuild)
  },
  server: {
    host: true,
    port: 5173
  }
});
