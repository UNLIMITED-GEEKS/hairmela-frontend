import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastComponent } from './core/toast/toast.component';
import { ConfirmDialogComponent } from './shared/components/confirm-dialog/confirm-dialog.component';
import { RenameDialogComponent } from './shared/components/rename-dialog/rename-dialog.component';
import { CookieConsentComponent } from './shared/components/cookie-consent/cookie-consent.component';
import { QueueSoundService } from './core/queue/queue-sound.service';
import { QueueSoundWatcherService } from './core/queue/queue-sound-watcher.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastComponent, ConfirmDialogComponent, RenameDialogComponent, CookieConsentComponent],
  templateUrl: './app.html',
  // Warms up the queue-sound Audio element on the very first tap/click
  // anywhere in the app — not scoped to the queue console page, since a
  // barber's first interaction of the session is more likely to happen on
  // whatever page they land on first (e.g. Salon Overview). One listener
  // here covers every page instead of duplicating the warm-up call across
  // each one. See QueueSoundService.warmUp() for why this needs to be a
  // real synchronous gesture handler, not just "some click happened".
  host: {
    '(document:pointerdown)': 'onFirstInteraction()',
  },
})
export class App {
  private readonly _queueSound = inject(QueueSoundService);
  // Eagerly instantiated so its watch effect runs for the app's lifetime —
  // keeps the barber's queue joined for sound from anywhere in the app, not
  // just the console page. See the service for the full rationale.
  private readonly _queueSoundWatcher = inject(QueueSoundWatcherService);

  protected onFirstInteraction(): void {
    this._queueSound.warmUp();
  }
}
