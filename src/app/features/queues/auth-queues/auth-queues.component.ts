import { Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../../api/api-configuration';
import { myEntriesControllerGetMyEntries } from '../../../api/fn/queues/my-entries-controller-get-my-entries';
import { QueueEntry } from '../../../api/models/queue-entry';

@Component({
  selector: 'app-auth-queues',
  templateUrl: './auth-queues.component.html',
})
export class AuthQueuesComponent implements OnInit {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _router = inject(Router);

  protected readonly entries = signal<QueueEntry[]>([]);
  protected readonly loading = signal(true);

  ngOnInit(): void {
    myEntriesControllerGetMyEntries(this._http, this._apiConfig.rootUrl).subscribe({
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
    this._router.navigate(['/s', slug, 'q', entry.queueId, 'e', entry.id, 'position']);
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
