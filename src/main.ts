import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// TEMPORARY DIAGNOSTIC — remove once the iOS empty-body upload is resolved.
// Reports how many service workers are registered, so a test run can't be
// misread (e.g. "I cleared it" when an old worker is in fact still active).
// Add ?nosw=1 to the URL to unregister everything and reload once without a
// service worker in the request path: if uploads work then and fail without
// the flag, the worker is the culprit.
if ('serviceWorker' in navigator) {
  const wantsUnregister = new URLSearchParams(location.search).has('nosw');
  void navigator.serviceWorker.getRegistrations().then(async (regs) => {
    if (wantsUnregister && regs.length > 0) {
      await Promise.all(regs.map((r) => r.unregister()));
      alert(`Unregistered ${regs.length} service worker(s). Reloading without SW…`);
      location.replace(location.pathname);
      return;
    }
    alert(`SW registrations: ${regs.length}${wantsUnregister ? ' (none to remove)' : ''}`);
  });
}

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
