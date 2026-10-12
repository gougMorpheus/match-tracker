import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build-Kennung fuer die Update-Pruefung der App (public /version.json vs. eingebaute Kennung).
const appBuild = process.env.COMMIT_REF || process.env.VITE_APP_BUILD || `local-${Date.now()}`;

const versionFilePlugin = () => ({
  name: "match-tracker-version-file",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: appBuild }) });
  }
});

export default defineConfig({
  plugins: [react(), versionFilePlugin()],
  define: {
    "import.meta.env.VITE_APP_BUILD": JSON.stringify(appBuild)
  },
  server: {
    host: true,
    port: 5173
  }
});
