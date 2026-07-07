import { Component, inject, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { QueueEntry } from '../../../api/models/queue-entry';
import { GuestQueuesService } from './guest-queues.service';

@Component({
  selector: 'app-guest-queues',
  templateUrl: './guest-queues.component.html',
  imports: [RouterLink],
})
export class GuestQueuesComponent implements OnInit {
  private readonly _router = inject(Router);
  private readonly _service = inject(GuestQueuesService);

  protected readonly entries = this._service.entries;
  protected readonly loading = this._service.loading;
  protected readonly error = this._service.error;

  ngOnInit(): void {
    this._service.load();
  }

  protected retry(): void {
    this._service.refresh();
  }

  protected goToPosition(entry: QueueEntry): void {
    const slug = entry.queue?.salon?.slug;
    if (!slug) return;
    this._router.navigate(['/g/s', slug, 'q', entry.queueId, 'e', entry.id, 'position']);
  }

  protected salonName(entry: QueueEntry): string {
    return entry.queue?.salon?.name ?? '';
  }

  protected leaderName(entry: QueueEntry): string {
    return entry.members.find((m) => m.isLeader)?.memberName ?? 'You';
  }

  protected partyCount(entry: QueueEntry): number {
    return entry.members.length;
  }
}
