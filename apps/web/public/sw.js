const APP_VERSION = new URL(self.location.href).searchParams.get("v") ?? "dev";
const APP_SHELL_CACHE = `fatma-app-shell-${APP_VERSION}`;
const STATIC_ASSET_CACHE = `fatma-static-assets-${APP_VERSION}`;
const APP_SHELL_URL = "/";
const PRECACHE_URLS = [
  APP_SHELL_URL,
  "/manifest.webmanifest",
  "/favicon.ico",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];
const STATIC_ASSET_DESTINATIONS = new Set(["style", "script", "worker", "font", "image"]);
const DYNAMIC_PATH_PREFIXES = ["/api/", "/attachments/"];

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAppShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(cleanupAndClaimClients());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }
  if (event.request.cache === "only-if-cached" && event.request.mode !== "same-origin") {
    return;
  }
  if (event.request.cache === "no-store") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (
    requestUrl.pathname === "/pwa-version.json" ||
    requestUrl.pathname === "/sw.js" ||
    DYNAMIC_PATH_PREFIXES.some((prefix) => requestUrl.pathname.startsWith(prefix))
  ) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(handleNavigationRequest(event.request));
    return;
  }

  if (STATIC_ASSET_DESTINATIONS.has(event.request.destination)) {
    event.respondWith(handleStaticAssetRequest(event.request));
  }
});

async function precacheAppShell() {
  const cache = await caches.open(APP_SHELL_CACHE);
  await cache.addAll(PRECACHE_URLS);
}

async function cleanupAndClaimClients() {
  const cacheKeys = await caches.keys();
  await Promise.all(
    cacheKeys
      .filter((cacheKey) => !cacheKey.endsWith(APP_VERSION))
      .map((cacheKey) => caches.delete(cacheKey)),
  );
  await self.clients.claim();
}

function isCacheableResponse(response) {
  return response.ok && (response.type === "basic" || response.type === "default");
}

async function handleNavigationRequest(request) {
  const cache = await caches.open(APP_SHELL_CACHE);

  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      await cache.put(APP_SHELL_URL, response.clone());
    }
    return response;
  } catch {
    const cachedAppShell = await cache.match(APP_SHELL_URL);
    if (cachedAppShell) {
      return cachedAppShell;
    }
    throw new Error("Unable to load the app shell.");
  }
}

async function handleStaticAssetRequest(request) {
  const cache = await caches.open(STATIC_ASSET_CACHE);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    void refreshStaticAsset(cache, request);
    return cachedResponse;
  }

  const networkResponse = await fetch(request);
  if (isCacheableResponse(networkResponse)) {
    await cache.put(request, networkResponse.clone());
  }
  return networkResponse;
}

async function refreshStaticAsset(cache, request) {
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      await cache.put(request, response.clone());
    }
  } catch {
    // Keep the cached asset and retry on the next request.
  }
}
