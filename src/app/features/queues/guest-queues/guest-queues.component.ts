import { Component, inject, signal, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { GuestHttpService } from '../../../core/guest/guest-http.service';
import { ActiveEntryStore } from '../../../core/queue/active-entry.store';
import { QueueEntry } from '../../../api/models/queue-entry';
import { deslugify } from '../../../utils/string.utils';

@Component({
  selector: 'app-guest-queues',
  templateUrl: './guest-queues.component.html',
  imports: [RouterLink],
})
export class GuestQueuesComponent implements OnInit {
  private readonly _guestHttp = inject(GuestHttpService);
  private readonly _activeEntryStore = inject(ActiveEntryStore);
  private readonly _router = inject(Router);

  protected readonly entries = signal<QueueEntry[]>([]);
  protected readonly loading = signal(true);

  ngOnInit(): void {
    this._guestHttp.getGuestEntries().subscribe({
      next: (list) => {
        this.entries.set(list);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected goToPosition(entry: QueueEntry): void {
    const stored = this._activeEntryStore.getForQueue(entry.queueId);
    if (!stored?.salonSlug) return;
    this._router.navigate(['/g/s', stored.salonSlug, 'q', entry.queueId, 'position']);
  }

  protected salonName(entry: QueueEntry): string {
    const slug = this._activeEntryStore.getForQueue(entry.queueId)?.salonSlug ?? '';
    return deslugify(slug);
  }

  protected leaderName(entry: QueueEntry): string {
    return entry.members.find((m) => m.isLeader)?.memberName ?? 'You';
  }

  protected partyCount(entry: QueueEntry): number {
    return entry.members.length;
  }
}
