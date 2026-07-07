import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { retry } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { QueueEntry } from '../../../api/models/queue-entry';
import { myEntriesControllerGetMyEntries } from '../../../api/fn/queues/my-entries-controller-get-my-entries';
import { TtlGate } from '../../../core/optimistic/ttl-gate';

@Injectable({ providedIn: 'root' })
export class ActiveQueuesService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);

  private readonly _entries = signal<QueueEntry[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal(false);
  private _inflight = false;

  // Short TTL, not an indefinite cache — this list can go stale from outside
  // this client (another device leaves a queue, an entry gets served) — see
  // CLAUDE.md's "never cache live queue state" rule. This only skips a
  // refetch on a same-second navigate-away-and-back; anything older refetches.
  private readonly _ttl = new TtlGate(15_000);

  readonly entries = this._entries.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  load(): void {
    if (this._inflight || this._ttl.isFresh()) return;
    this._inflight = true;
    this._loading.set(true);
    this._error.set(false);
    myEntriesControllerGetMyEntries(this._http, this._apiConfig.rootUrl)
      .pipe(retry(1))
      .subscribe({
        next: (res) => {
          this._inflight = false;
          this._entries.set(res.body);
          this._loading.set(false);
          this._ttl.markFetched();
        },
        error: () => {
          this._inflight = false;
          this._error.set(true);
          this._loading.set(false);
        },
      });
  }

  /** Bypasses the TTL — call after an action that changes this list (e.g. leaving a queue). */
  refresh(): void {
    this._ttl.invalidate();
    this.load();
  }
}
