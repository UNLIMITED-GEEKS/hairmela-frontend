import { Component, inject } from '@angular/core';
import { AppPlatformService } from '../../../core/native/app-platform.service';

/**
 * HairMela mark and wordmark above the login and register forms — APP CONTEXT
 * ONLY (Capacitor APK, installed PWA, iOS standalone).
 *
 * Deliberately absent on the web: those pages render inside the public shell,
 * whose marketing nav already carries the brand directly above them, and a
 * second logo underneath it just repeats itself. The installed app has no nav
 * at all, so without this the first screen of a cold launch is an unbranded
 * form.
 *
 * Its own component rather than the same block pasted into both templates —
 * two copies of a platform-gated brand header is exactly the kind of pair that
 * drifts apart.
 */
@Component({
  selector: 'app-auth-brand',
  template: `
    @if (platform.isAppContext) {
      <div class="mb-6 flex flex-col items-center gap-2.5">
        <img
          src="/icons/icon-192x192.png"
          alt=""
          width="56"
          height="56"
          class="h-14 w-14 rounded-2xl object-contain"
        />
        <span class="text-lg font-bold tracking-tight text-text-primary">HairMela</span>
      </div>
    }
  `,
})
export class AuthBrandComponent {
  protected readonly platform = inject(AppPlatformService);
}
