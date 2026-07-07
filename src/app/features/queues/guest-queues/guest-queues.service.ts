import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { retry } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { QueueEntry } from '../../../api/models/queue-entry';
import { guestEntriesControllerGetGuestEntries } from '../../../api/fn/queues/guest-entries-controller-get-guest-entries';
import { TtlGate } from '../../../core/optimistic/ttl-gate';

@Injectable({ providedIn: 'root' })
export class GuestQueuesService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);

  private readonly _entries = signal<QueueEntry[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal(false);
  private _inflight = false;

  // Short TTL, not an indefinite cache — see ActiveQueuesService for why.
  private readonly _ttl = new TtlGate(15_000);

  readonly entries = this._entries.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  load(): void {
    if (this._inflight || this._ttl.isFresh()) return;
    this._inflight = true;
    this._loading.set(true);
    this._error.set(false);
    guestEntriesControllerGetGuestEntries(this._http, this._apiConfig.rootUrl)
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
