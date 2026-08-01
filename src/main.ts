import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { readSwFlag, swDisabled } from './app/core/pwa/sw-diagnostic';

// TEMPORARY DIAGNOSTIC — remove once the iOS empty-body upload is resolved.
// See core/pwa/sw-diagnostic.ts. ?nosw=1 to go SW-free, ?nosw=0 to undo.
readSwFlag();

async function bootstrap(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();

    // Unregister BEFORE bootstrapping, so Angular can't re-register in the
    // gap, and reload once so the page is no longer controlled.
    if (swDisabled() && (regs.length > 0 || navigator.serviceWorker.controller)) {
      await Promise.all(regs.map((r) => r.unregister()));
      alert(`Unregistered ${regs.length} worker(s). Reloading SW-free…`);
      location.reload();
      return;
    }

    alert(
      `SW registrations: ${regs.length}\n` +
        `controlled: ${!!navigator.serviceWorker.controller}\n` +
        `nosw flag: ${swDisabled()}`,
    );
  }

  await bootstrapApplication(App, appConfig);
}

bootstrap().catch((err) => console.error(err));
