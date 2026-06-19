import { Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { QueueConsoleService } from '../queue-console/queue-console.service';

@Component({
  selector: 'app-queue-list',
  templateUrl: './queue-list.component.html',
})
export class QueueListComponent {
  protected readonly console = inject(QueueConsoleService);
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  private get _queueId(): string {
    return this._route.snapshot.paramMap.get('queueId') ?? '';
  }

  protected noShow(entryId: string): void {
    this.console.noShow(this._salonId, this._queueId, entryId);
  }

  protected cancelEntry(entryId: string): void {
    this.console.cancelEntry(this._salonId, this._queueId, entryId);
  }
}
