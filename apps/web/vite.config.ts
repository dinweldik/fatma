import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babelPlugin from "@rolldown/plugin-babel";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig, type Plugin } from "vite";
const webPackageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };
const appVersion = webPackageJson.version;

function resolveAppBuildId(version: string): string {
  const explicitBuildId = process.env.FATMA_BUILD_ID?.trim();
  if (explicitBuildId) {
    return explicitBuildId;
  }

  const commitFromEnv =
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.GITHUB_SHA?.trim() ||
    process.env.SOURCE_VERSION?.trim() ||
    process.env.GIT_COMMIT?.trim();
  if (commitFromEnv) {
    return `${version}+${commitFromEnv.slice(0, 12)}`;
  }

  try {
    const gitCommit = execSync("git rev-parse --short=12 HEAD", {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString("utf8")
      .trim();
    if (gitCommit.length > 0) {
      return `${version}+${gitCommit}`;
    }
  } catch {
    // Fall back to the package version when git metadata is unavailable.
  }

  return version;
}

const appBuildId = resolveAppBuildId(appVersion);

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
  process.env.FATMA_WEB_SOURCEMAP?.trim().toLowerCase();

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
        source: `${JSON.stringify({ appBuildId, appVersion }, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [
    tanstackRouter(),
    react(),
    babelPlugin({
      presets: [reactCompilerPreset({ target: "19", compilationMode: "annotation" })],
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
    __APP_BUILD_ID__: JSON.stringify(appBuildId),
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
