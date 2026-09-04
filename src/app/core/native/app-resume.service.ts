import { Injectable, inject, signal } from '@angular/core';
import { AppPlatformService } from './app-platform.service';

// Fires whenever the app returns to the foreground.
//
// WHY IT EXISTS: work that leaves the app — today only the payment provider's
// checkout page — has no reliable "the user came back" signal of its own. The
// provider's redirect covers the paths where it actually redirects, but not
// the user simply backing out of the browser, which sends no callback at all.
// The app then sits with whatever in-flight state it had when it left (see
// BillingService's acting lock, which is what left Upgrade stuck on
// "Working…").
//
// A counter rather than a boolean: consumers want to react to EACH return, and
// a flag that is already true cannot report the next one.
//
// WEB PAYS NOTHING FOR THIS. @capacitor/app is behind a dynamic import()
// inside an isNative guard, so the bundler splits it into a lazy chunk a web
// build never requests — the rule NativeBackButtonService documents at length.
// Do not convert this to a static import.
@Injectable({ providedIn: 'root' })
export class AppResumeService {
  private readonly _platform = inject(AppPlatformService);

  private readonly _resumed = signal(0);

  /** Increments each time the app returns to the foreground. Never fires on web. */
  readonly resumed = this._resumed.asReadonly();

  async init(): Promise<void> {
    if (!this._platform.isNative) return;

    const { App: CapacitorApp } = await import('@capacitor/app');
    await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) this._resumed.update((n) => n + 1);
    });
  }
}
