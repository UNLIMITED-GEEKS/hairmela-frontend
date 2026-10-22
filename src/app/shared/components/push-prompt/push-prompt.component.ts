import { NgTemplateOutlet } from '@angular/common';
import { Component, HostListener, computed, inject, input, signal } from '@angular/core';
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
  imports: [NgTemplateOutlet],
})
export class PushPromptComponent {
  private readonly _push = inject(PushService);
  private readonly _toast = inject(ToastService);

  readonly title = input("Get notified when it's your turn?");
  readonly body = input(
    "We'll send a notification when the staff is ready for you, even if this tab is closed.",
  );

  // When set, "Not now" hides the prompt for this many hours and then lets it
  // back, instead of retiring it for good (the default, used by the one-off
  // contextual prompts). The permanent "already asked" flag is ignored in this
  // mode — a recurring prompt would otherwise be silenced by any earlier
  // one-off dismissal on the same device.
  // 'modal' floats the same card over the page with a backdrop (tap outside or
  // Escape = "Not now"); 'inline' renders it in the page flow.
  readonly display = input<'inline' | 'modal'>('inline');

  readonly remindAfterHours = input<number | null>(null);

  private readonly _dismissed = signal(false);
  protected readonly busy = signal(false);

  // Computed, not a one-shot signal: on native the permission state is only
  // known asynchronously and reports 'unknown' until it settles. Sampling once
  // at construction (as this did) would evaluate against 'unknown' and never
  // re-check — and treating 'unknown' as promptable would flash this at a user
  // who had already granted or refused. Only an explicit 'default' shows it.
  protected readonly visible = computed(
    () =>
      !this._dismissed() &&
      this._push.isSupported &&
      this._push.permissionState() === 'default' &&
      (this.remindAfterHours() === null
        ? !this._push.hasAsked()
        : !this._push.isSnoozed(this.remindAfterHours()!)),
  );

  protected async enable(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this._push.markAsked();

    const result = await this._push.enable();
    this.busy.set(false);
    this._dismissed.set(true);

    if (result === 'enabled') {
      this._toast.success("Done — we'll let you know when it's your turn.");
    } else if (result === 'denied') {
      this._toast.info('No problem — you can turn this on later in your account.');
    } else {
      // Permission was granted but registration or the server call failed —
      // "turn it on in your account" would be misleading advice here.
      this._toast.error("Couldn't set up notifications. Please try again later.");
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.display() === 'modal' && this.visible()) this.dismiss();
  }

  protected dismiss(): void {
    if (this.remindAfterHours() === null) this._push.markAsked();
    else this._push.snooze();
    this._dismissed.set(true);
  }
}
