import { Component, inject } from '@angular/core';
import { QueueSoundPreferenceService } from '../../../core/queue/queue-sound-preference.service';
import { ToastService } from '../../../core/toast/toast.service';

// Account-level control for the queue console's sound notification —
// see QueueSoundPreferenceService for why real playback isn't wired yet
// (waiting on a backend change to distinguish who caused a queue update).
@Component({
  selector: 'app-queue-sound-toggle',
  templateUrl: './queue-sound-toggle.component.html',
})
export class QueueSoundToggleComponent {
  private readonly _toast = inject(ToastService);
  protected readonly _preference = inject(QueueSoundPreferenceService);

  protected readonly enabled = this._preference.enabled;

  protected enable(): void {
    this._preference.setEnabled(true);
    this._toast.success('Queue sound on.');
  }

  protected disable(): void {
    this._preference.setEnabled(false);
    this._toast.info('Queue sound off.');
  }
}
