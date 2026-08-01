// Custom service worker: forwards non-GET requests straight to the network,
// then delegates everything else to Angular's ngsw-worker.js.
//
// Without this, multipart uploads from iOS reached the backend with a correct
// Content-Type and boundary but contentLength=0 — an empty body, missing the
// file AND the plain text fields. Measured on-device: the serialized body was
// ~2.8MB leaving the page, and the same upload succeeded as soon as the
// service worker was unregistered. So the body is intact in the app and lost
// while passing through the worker.
//
// Angular's handleFetch() awaits ensureInitialized() and assignVersion()
// before forwarding a request it doesn't serve from cache, and a fetch event's
// request body is a single-use stream. Forwarding it after those awaits is the
// likely mechanism, though that specific step hasn't been isolated — what is
// confirmed is that removing the worker from the path fixes it.
//
// Note that /v1/media/upload matches nothing in ngsw-config.json: not being
// cached does not mean not being intercepted. The fetch handler sees every
// request from the page, so uploads went through the worker regardless.
//
// Registering this listener before importScripts means it runs first and
// claims non-GET requests in the same synchronous turn, body stream intact.
// GETs fall through untouched, so app-shell caching and update checks are
// unaffected.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
  }
});

importScripts('./ngsw-worker.js');
