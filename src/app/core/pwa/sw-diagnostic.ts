// TEMPORARY DIAGNOSTIC — remove once the iOS empty-body upload is resolved.
//
// Lets a device opt out of the service worker for a session, to test whether
// the worker is what empties multipart upload bodies (the probe in
// upload-media.ts shows the body leaving the app intact, so the loss is
// somewhere below Angular — the worker is one candidate, the CDN edge another).
//
//   ?nosw=1  → unregister every worker, reload SW-free
//   ?nosw=0  → clear the flag, back to normal
//
// sessionStorage rather than the query param alone: the flag has to survive
// the reload, or provideServiceWorker registers again on the next boot and the
// upload runs controlled anyway.
const NOSW_KEY = 'diag:nosw';

/** Read ?nosw= and persist it for the session. Call once, before bootstrap. */
export function readSwFlag(): void {
  const param = new URLSearchParams(location.search).get('nosw');
  if (param === '0') sessionStorage.removeItem(NOSW_KEY);
  else if (param !== null) sessionStorage.setItem(NOSW_KEY, '1');
}

export function swDisabled(): boolean {
  return sessionStorage.getItem(NOSW_KEY) === '1';
}
