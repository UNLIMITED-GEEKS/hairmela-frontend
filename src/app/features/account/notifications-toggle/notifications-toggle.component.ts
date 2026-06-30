import { Component, computed, inject, signal } from '@angular/core';
import { PushService } from '../../../core/push/push.service';
import { ToastService } from '../../../core/toast/toast.service';

// Account-level push control — a way back in for users who dismissed the
// contextual prompt, and a way out for those who want to stop. Reflects the
// real browser permission + subscription state, so it can't drift from reality.
@Component({
  selector: 'app-notifications-toggle',
  templateUrl: './notifications-toggle.component.html',
})
export class NotificationsToggleComponent {
  private readonly _push = inject(PushService);
  private readonly _toast = inject(ToastService);

  protected readonly busy = signal(false);

  protected readonly supported = this._push.isSupported;
  protected readonly subscribed = this._push.subscribed;

  // Permission was explicitly denied at the browser level — the user must
  // re-enable in browser settings; an in-app toggle can't override that.
  protected readonly blockedByBrowser = computed(() => this._push.permission === 'denied');

  protected async enable(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    const result = await this._push.enable();
    this.busy.set(false);

    if (result === 'enabled') {
      this._toast.success('Notifications on.');
    } else if (result === 'denied') {
      this._toast.info('Permission blocked — enable notifications in your browser settings.');
    }
  }

  protected async disable(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    await this._push.disable();
    this.busy.set(false);
    this._toast.info('Notifications off.');
  }
}
