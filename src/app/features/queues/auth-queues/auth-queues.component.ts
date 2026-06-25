import { Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../../api/api-configuration';
import { myEntriesControllerGetMyEntries } from '../../../api/fn/queues/my-entries-controller-get-my-entries';
import { ActiveEntryStore } from '../../../core/queue/active-entry.store';
import { QueueEntry } from '../../../api/models/queue-entry';
import { deslugify } from '../../../utils/string.utils';

@Component({
  selector: 'app-auth-queues',
  templateUrl: './auth-queues.component.html',
})
export class AuthQueuesComponent implements OnInit {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _activeEntryStore = inject(ActiveEntryStore);
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
    const stored = this._activeEntryStore.getForQueue(entry.queueId);
    if (!stored?.salonSlug) return;
    this._router.navigate(['/s', stored.salonSlug, 'q', entry.queueId, 'position']);
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
