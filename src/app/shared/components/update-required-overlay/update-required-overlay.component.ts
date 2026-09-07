import { Component, inject } from '@angular/core';
import { AppUpdateService } from '../../../core/native/app-update.service';

// Blocking "you must update" screen for the Play build.
//
// DELIBERATELY NOT DISMISSABLE: no close button, no backdrop click, no escape
// handler. It only appears for a release published at a high in-app update
// priority (see AppUpdateService), which is reserved for versions people
// cannot stay behind — so an escape hatch would defeat the point.
//
// Google's own update sheet is launched immediately and covers this; the
// overlay is what remains if the user dismisses that sheet, and its button
// starts the flow again.
@Component({
  selector: 'app-update-required-overlay',
  template: `
    @if (updates.updateRequired()) {
      <!-- Above everything: the top bar sits at z-50 and the bottom sheet at
           45, so an overlay that must not be worked around goes higher than
           both. -->
      <div
        class="fixed inset-0 z-[100] flex items-center justify-center bg-surface px-6"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="update-required-title"
      >
        <div class="w-full max-w-sm text-center">
          <img
            src="/icons/icon-192x192.png"
            alt=""
            width="64"
            height="64"
            class="mx-auto h-16 w-16 rounded-2xl object-contain"
          />

          <h1 id="update-required-title" class="mt-6 text-xl font-bold text-text-primary">
            An important update is ready
          </h1>
          <p class="mt-2 text-sm text-text-secondary leading-relaxed">
            This version of HairMela is out of date. Please update now to keep using the app.
          </p>

          <button
            type="button"
            (click)="updates.startUpdate()"
            class="mt-8 w-full min-h-12 rounded-2xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors"
          >
            Update now
          </button>
        </div>
      </div>
    }
  `,
})
export class UpdateRequiredOverlayComponent {
  protected readonly updates = inject(AppUpdateService);
}
