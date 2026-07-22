import { Component, inject, signal } from '@angular/core';
import { Location, DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { QueueConsoleService } from '../queue-console/queue-console.service';
import { AddClientModalComponent } from '../add-client-modal/add-client-modal.component';
import { ToastService } from '../../../core/toast/toast.service';
import { QueueSoundPreferenceService } from '../../../core/queue/queue-sound-preference.service';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { PushPromptComponent } from '../../../shared/components/push-prompt/push-prompt.component';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-queue-list',
  templateUrl: './queue-list.component.html',
  imports: [InlineSpinnerComponent, AddClientModalComponent, DatePipe, RouterLink, PushPromptComponent],
})
export class QueueListComponent {
  protected readonly console = inject(QueueConsoleService);
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _toast = inject(ToastService);
  protected readonly soundPreference = inject(QueueSoundPreferenceService);

  protected readonly showAddQueueModal = signal(false);

  // Dismissed for this page view only (not persisted) — reappears next time
  // the console is opened, unless the barber turns sound back on in Account
  // settings. Real sound playback isn't wired yet — see
  // QueueSoundPreferenceService's own comment for why (waiting on a backend
  // change to distinguish who caused a queue update).
  protected readonly soundOffBannerDismissed = signal(false);
  protected readonly accountLink = RoutePath.account();

  protected get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  protected get _queueId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.QUEUE_ID) ?? '';
  }

  protected get _staffId(): string {
    return this.console.queue()?.staffId ?? '';
  }

  protected noShow(entryId: string): void {
    this.console.noShow(this._salonId, this._queueId, entryId);
  }

  protected cancelEntry(entryId: string): void {
    this.console.cancelEntry(this._salonId, this._queueId, entryId);
  }

  protected copyPhone(phone: string): void {
    navigator.clipboard.writeText(phone).then(() => this._toast.success('Phone copied.'));
  }

  protected openAddQueueModal(): void {
    this.showAddQueueModal.set(true);
  }
}
