import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastComponent } from './core/toast/toast.component';
import { ConfirmDialogComponent } from './shared/components/confirm-dialog/confirm-dialog.component';
import { RenameDialogComponent } from './shared/components/rename-dialog/rename-dialog.component';
import { UpdateRequiredOverlayComponent } from './shared/components/update-required-overlay/update-required-overlay.component';
import { CookieConsentComponent } from './shared/components/cookie-consent/cookie-consent.component';
import { QueueSoundService } from './core/queue/queue-sound.service';
import { QueueSoundWatcherService } from './core/queue/queue-sound-watcher.service';
import { SalonContextService } from './core/salon-context/salon-context.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastComponent, ConfirmDialogComponent, RenameDialogComponent, CookieConsentComponent, UpdateRequiredOverlayComponent],
  templateUrl: './app.html',
  // Warms up the queue-sound Audio element on the very first tap/click
  // anywhere in the app — not scoped to the queue console page, since a
  // barber's first interaction of the session is more likely to happen on
  // whatever page they land on first (e.g. Salon Overview). One listener
  // here covers every page instead of duplicating the warm-up call across
  // each one. See QueueSoundService.warmUp() for why this needs to be a
  // real synchronous gesture handler, not just "some click happened".
  //
  // Gated on displayMembership() (staff-only) in onFirstInteraction() below —
  // a customer never triggers the real chime (QueueSoundWatcherService only
  // watches a queue for staff), so warming up audio for them is pointless,
  // and doing it unconditionally was the actual bug: on iOS, warmUp()'s
  // play()-then-pause() could let an audible blip of the real chime through
  // (see queue-sound.service.ts's muted fix), and it was firing for every
  // visitor's first tap, not just staff.
  host: {
    '(document:pointerdown)': 'onFirstInteraction()',
  },
})
export class App {
  private readonly _queueSound = inject(QueueSoundService);
  private readonly _salonContext = inject(SalonContextService);
  // Eagerly instantiated so its watch effect runs for the app's lifetime —
  // keeps the barber's queue joined for sound from anywhere in the app, not
  // just the console page. See the service for the full rationale.
  private readonly _queueSoundWatcher = inject(QueueSoundWatcherService);

  protected onFirstInteraction(): void {
    if (!this._salonContext.displayMembership()) return;
    this._queueSound.warmUp();
  }
}
