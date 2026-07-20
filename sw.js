const CACHE_NAME = "german-lms-shell-v1";
const SHELL_FILES = ["./", "index.html", "manifest.json", "icon.png"];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Network-first for navigations/HTML so a redeploy is picked up immediately;
// cache-first for the static shell assets (icon/manifest rarely change).
self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;

    const isNavigation = req.mode === "navigate" || (req.destination === "document");
    if (isNavigation) {
        event.respondWith(
            fetch(req).then((res) => {
                caches.open(CACHE_NAME).then((cache) => cache.put("index.html", res.clone()));
                return res;
            }).catch(() => caches.match("index.html"))
        );
        return;
    }

    event.respondWith(
        caches.match(req).then((cached) => cached || fetch(req))
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ("focus" in client) return client.focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow("./");
        })
    );
});
