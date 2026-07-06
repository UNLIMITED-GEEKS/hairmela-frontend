import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { retry } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { QueueEntry } from '../../../api/models/queue-entry';
import { myEntriesControllerGetMyEntries } from '../../../api/fn/queues/my-entries-controller-get-my-entries';

@Injectable({ providedIn: 'root' })
export class ActiveQueuesService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);

  private readonly _entries = signal<QueueEntry[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal(false);
  private _inflight = false;

  readonly entries = this._entries.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  load(): void {
    if (this._inflight) return;
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
        },
        error: () => {
          this._inflight = false;
          this._error.set(true);
          this._loading.set(false);
        },
      });
  }
}
