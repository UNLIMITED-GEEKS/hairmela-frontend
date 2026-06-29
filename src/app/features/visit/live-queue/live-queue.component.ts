import { Component, OnInit, inject } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SalonVisitService } from '../salon-visit.service';

@Component({
  selector: 'app-live-queue',
  templateUrl: './live-queue.component.html',
  imports: [RouterLink],
})
export class LiveQueueComponent implements OnInit {
  protected readonly visit = inject(SalonVisitService);
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);

  protected get _queueId(): string {
    return this._route.snapshot.paramMap.get('queueId') ?? '';
  }

  private get _shellPrefix(): string {
    return this._route.snapshot.data['shellPrefix'] ?? '';
  }

  /** True when any of the caller's own entries are in this queue. */
  protected hasMyEntries(): boolean {
    return this.visit.waitingEntries().some((e) => this.visit.isMine(e.entryId));
  }

  protected get myQueuesUrl(): string {
    return this._shellPrefix ? `${this._shellPrefix}/queues` : '/queues';
  }

  ngOnInit(): void {
    this.visit.watchQueue(this._queueId);
  }
}
