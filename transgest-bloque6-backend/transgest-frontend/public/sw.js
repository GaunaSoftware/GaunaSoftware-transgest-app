self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key).catch(() => false)));
    if (self.registration?.unregister) {
      await self.registration.unregister().catch(() => false);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", () => {});
