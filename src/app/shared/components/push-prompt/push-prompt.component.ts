import { Component, inject, input, signal } from '@angular/core';
import { PushService } from '../../../core/push/push.service';
import { ToastService } from '../../../core/toast/toast.service';

// Contextual permission nudge — shown after a customer joins a queue, the
// moment push is most clearly worth it ("we'll tell you when it's your turn").
// NEVER shown on page load: browsers penalise unprompted permission requests.
// Self-gating: renders only when push can run, permission hasn't been decided,
// and we haven't already asked on this device.
//
// title/body default to the customer-facing copy above; the barber-facing
// queue console passes its own text (see queue-list.component.html) since
// "when it's your turn" doesn't make sense for someone running the queue,
// not waiting in it.
@Component({
  selector: 'app-push-prompt',
  templateUrl: './push-prompt.component.html',
})
export class PushPromptComponent {
  private readonly _push = inject(PushService);
  private readonly _toast = inject(ToastService);

  readonly title = input("Get notified when it's your turn?");
  readonly body = input("We'll send a notification when the staff is ready for you — even if this tab is closed.");

  private readonly _dismissed = signal(false);
  protected readonly busy = signal(false);

  protected readonly visible = signal(this._shouldShow());

  private _shouldShow(): boolean {
    return (
      this._push.isSupported &&
      this._push.permission === 'default' &&
      !this._push.hasAsked()
    );
  }

  protected async enable(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this._push.markAsked();

    const result = await this._push.enable();
    this.busy.set(false);
    this._dismissed.set(true);
    this.visible.set(false);

    if (result === 'enabled') {
      this._toast.success("Done — we'll let you know when it's your turn.");
    } else if (result === 'denied') {
      this._toast.info('No problem — you can turn this on later in your account.');
    }
  }

  protected dismiss(): void {
    this._push.markAsked();
    this._dismissed.set(true);
    this.visible.set(false);
  }
}
