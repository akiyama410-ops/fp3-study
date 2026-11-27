// 電波がなくてもアプリを開けるように、アプリ本体をこの端末に保存しておく仕組み。
// アプリを更新したら VERSION の数字を上げてください。
const VERSION = "v4";
const CACHE = `fp3-app-${VERSION}`;
const APP_FILES = [
  "./",
  "index.html",
  "css/app.css",
  "js/app.js",
  "js/config.js",
  "js/data.js",
  "js/player.js",
  "js/stats.js",
  "js/store.js",
  "vendor/supabase.js",
  "vendor/pdf.min.js",
  "vendor/pdf.worker.min.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_FILES.map((f) => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("fp3-app-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// アプリ本体：ネットを先に試し、だめならこの端末の保存分を使う（更新がすぐ届くように）
// cache: "no-cache" で、ブラウザが覚えている古いファイルではなく、毎回新しい版があるかを確かめる
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html"))),
  );
});
