/* Service Worker Match-Tracker (Stufe b: echte Push-Meldungen). Build: __APP_BUILD__
 * - App-Huelle: Navigation network-first (Fallback Cache), /assets/* cache-first (gehashte Dateien).
 * - Nie gecacht: alles fremde (Supabase-API, Realtime), version.json, sw.js, Nicht-GET.
 * - Update: neuer Build => neuer Cache-Name, skipWaiting + clients.claim, alte Caches werden geloescht.
 *   Die App prueft zusaetzlich version.json und laedt bei neuem Build neu.
 * - push: zeigt die Meldung der Netlify Function (push-dispatch) an; notificationclick oeffnet das Spiel in View only (?tv=1).
 */
const BUILD = "__APP_BUILD__";
const CACHE = `mt-shell-${BUILD}`;
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => undefined).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("mt-shell-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

const isNeverCached = (url) =>
  url.origin !== self.location.origin ||
  url.pathname === "/version.json" ||
  url.pathname === "/sw.js" ||
  url.pathname.startsWith("/.netlify/");

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (isNeverCached(url)) return; // Browser/Netzwerk direkt, kein SW-Cache (Sync bleibt aktuell)

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put("/index.html", copy)); }
          return response;
        })
        .catch(() => caches.match("/index.html").then((cached) => cached || Response.error()))
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)); }
        return response;
      }))
    );
  }
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Server sendet JSON { title, body, gameId, tag, url }. url ist immer ein Pfad dieser App (View only).
const gameUrl = (gameId) => (gameId ? `/#/game/${encodeURIComponent(gameId)}?tv=1` : "/#/games");
const targetUrl = (data) => (typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//") ? data.url : gameUrl(data.gameId));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  const title = data.title || "Match-Tracker";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || (data.gameId ? `game-${data.gameId}` : undefined),
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      timestamp: Date.now(),
      data: { url: targetUrl(data) }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/#/games", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          return client.navigate(target).then((c) => (c || client).focus()).catch(() => self.clients.openWindow(target));
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
