const CACHE_PREFIX = "alexandria-public-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const STATIC_SHELL = ["/manifest.webmanifest", "/icons/alexandria-192.png", "/icons/alexandria-512.png"];

function isCacheablePublicAsset(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/src/") ||
    url.pathname.startsWith("/@") ||
    url.pathname.startsWith("/node_modules/.vite/") ||
    STATIC_SHELL.includes(url.pathname)
  );
}

function assetUrlsFrom(html) {
  const urls = new Set();
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = new URL(match[1], self.location.origin);
    if (url.origin === self.location.origin && isCacheablePublicAsset(url)) {
      urls.add(url.pathname);
    }
  }
  return [...urls];
}

async function precachePublicShell() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch("/", { cache: "reload" });
  if (!response.ok) throw new Error("Unable to cache the Alexandria shell.");

  const [html] = await Promise.all([response.clone().text(), cache.put("/", response)]);
  await cache.addAll([...new Set([...STATIC_SHELL, ...assetUrlsFrom(html)])]);
}

async function cacheLoadedPublicAssets(urls) {
  const cache = await caches.open(CACHE_NAME);
  for (const rawUrl of urls) {
    const url = new URL(rawUrl, self.location.origin);
    if (url.origin !== self.location.origin || !isCacheablePublicAsset(url)) continue;
    const response = await fetch(url, { cache: "reload" });
    if (response.ok) await cache.put(url, response);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precachePublicShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_PUBLIC_ASSETS" || !Array.isArray(event.data.urls)) return;
  event.waitUntil(cacheLoadedPublicAssets(event.data.urls));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  // API calls can contain public data that must stay fresh or administrator
  // data tied to an Authorization header. They are always handled by the app.
  // Uploaded documents have their own security-isolated content origin.
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || event.request.headers.has("authorization")) return;

  if (event.request.mode === "navigate") {
    const response = fetch(event.request).catch(async () => (await caches.match(event.request)) ?? (await caches.match("/")));
    event.respondWith(response);
    return;
  }

  if (!isCacheablePublicAsset(url)) return;

  const response = caches.match(event.request, { ignoreVary: true }).then((cached) => {
      if (cached !== undefined) return cached;
      return fetch(event.request);
    });
  event.respondWith(response);
});
