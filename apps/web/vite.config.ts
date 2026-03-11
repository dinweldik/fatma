import { readFileSync } from "node:fs";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig, type Plugin } from "vite";
const webPackageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };
const appVersion = webPackageJson.version;

const port = Number(process.env.PORT ?? 5774);
const host = process.env.FATMA_HOST?.trim() || "localhost";
const isDesktopMode = process.env.FATMA_MODE === "desktop";
const extraAllowedHosts =
  process.env.FATMA_VITE_ALLOWED_HOSTS?.split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0) ?? [];
const allowedHosts = Array.from(new Set([".ts.net", ...extraAllowedHosts]));
const sourcemapEnv =
  process.env.FATMA_WEB_SOURCEMAP?.trim().toLowerCase() ??
  process.env.T3CODE_WEB_SOURCEMAP?.trim().toLowerCase();

const buildSourcemap =
  sourcemapEnv === "0" || sourcemapEnv === "false"
    ? false
    : sourcemapEnv === "hidden"
      ? "hidden"
      : true;

const isWildcardHost = (value: string): boolean =>
  value === "0.0.0.0" || value === "::" || value === "[::]";

const hmrHost = isDesktopMode ? "localhost" : isWildcardHost(host) ? undefined : host;
const hmr = hmrHost ? { protocol: "ws", host: hmrHost } : { protocol: "ws" };

function emitPwaVersion(): Plugin {
  return {
    name: "emit-pwa-version",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "pwa-version.json",
        source: `${JSON.stringify({ appVersion }, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [
    tanstackRouter(),
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", { target: "19" }]],
      },
    }),
    tailwindcss(),
    emitPwaVersion(),
  ],
  optimizeDeps: {
    include: ["@pierre/diffs", "@pierre/diffs/react", "@pierre/diffs/worker/worker.js"],
  },
  define: {
    // In dev mode, tell the web app where the WebSocket server lives
    "import.meta.env.VITE_WS_URL": JSON.stringify(process.env.VITE_WS_URL ?? ""),
    __APP_VERSION__: JSON.stringify(appVersion),
    "import.meta.env.APP_VERSION": JSON.stringify(appVersion),
  },
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    host,
    allowedHosts,
    port,
    strictPort: true,
    hmr: {
      // Explicit config so Vite's HMR WebSocket connects reliably
      // inside Electron's BrowserWindow. Vite 8 uses console.debug for
      // connection logs — enable "Verbose" in DevTools to see them.
      ...hmr,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: buildSourcemap,
  },
});
