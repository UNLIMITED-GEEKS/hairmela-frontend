import { Component, inject, signal } from '@angular/core';
import { Location, DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { QueueConsoleService } from '../queue-console/queue-console.service';
import { AddClientModalComponent } from '../add-client-modal/add-client-modal.component';
import { ToastService } from '../../../core/toast/toast.service';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { RouteParam } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-queue-list',
  templateUrl: './queue-list.component.html',
  imports: [InlineSpinnerComponent, AddClientModalComponent, DatePipe],
})
export class QueueListComponent {
  protected readonly console = inject(QueueConsoleService);
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _toast = inject(ToastService);

  protected readonly showAddQueueModal = signal(false);

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
