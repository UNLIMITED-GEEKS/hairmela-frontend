import { Component, inject, signal, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { ApiConfiguration } from '../../../api/api-configuration';
import { guestEntriesControllerGetGuestEntries } from '../../../api/fn/queues/guest-entries-controller-get-guest-entries';
import { QueueEntry } from '../../../api/models/queue-entry';

@Component({
  selector: 'app-guest-queues',
  templateUrl: './guest-queues.component.html',
  imports: [RouterLink],
})
export class GuestQueuesComponent implements OnInit {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _router = inject(Router);

  protected readonly entries = signal<QueueEntry[]>([]);
  protected readonly loading = signal(true);

  ngOnInit(): void {
    guestEntriesControllerGetGuestEntries(this._http, this._apiConfig.rootUrl).subscribe({
      next: (res) => {
        this.entries.set(res.body);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected goToPosition(entry: QueueEntry): void {
    // Slug comes from the entry's own server payload — never the client store,
    // which can be missing/out of sync after the queue changes server-side.
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
