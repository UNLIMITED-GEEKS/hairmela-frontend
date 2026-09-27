import { Component, inject } from '@angular/core';
import { AppUpdateService } from '../../../core/native/app-update.service';

// "Please update" screen for the native Android and iOS builds.
//
// DISMISSABLE, BUT IT COMES BACK. The close button hides it for this run only
// — AppUpdateService.dismiss() keeps nothing, so the next launch re-runs the
// check and shows it again. That way it never traps someone mid-task (a
// barber part-way through serving a client can close it and finish) while
// still asking every time they reopen the app.
//
// Only the close button dismisses it: no backdrop click and no escape
// handler, so it cannot be waved away by accident. On Android the button
// starts Play's update flow; on iOS it opens HairMela in the App Store.
@Component({
  selector: 'app-update-required-overlay',
  template: `
    @if (updates.updateRequired()) {
      <!-- Above everything: the top bar sits at z-50 and the bottom sheet at
           45, so an overlay that must not be worked around goes higher than
           both. -->
      <div
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-6"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="update-required-title"
      >
        <!-- A CARD ON A SCRIM, not a full-screen panel: the overlay above is
             a dim backdrop so the app stays visible behind it, and this is the
             surface that sits on top. relative anchors the close button to the
             card rather than to the whole screen. -->
        <div class="relative w-full max-w-sm rounded-2xl bg-surface-card p-6 pt-8 text-center shadow-2xl">
          <!-- Top-right OF THE CARD, and well clear of "Update now" below, so
               closing is never a mis-tap on the primary action. -->
          <button
            type="button"
            (click)="updates.dismiss()"
            aria-label="Close"
            class="absolute top-2 right-2 min-w-11 min-h-11 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

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
