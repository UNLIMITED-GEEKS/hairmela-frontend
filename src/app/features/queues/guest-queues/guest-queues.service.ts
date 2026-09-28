import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { retry } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { QueueEntry } from '../../../api/models/queue-entry';
import { guestEntriesControllerGetGuestEntryHistory } from '../../../api/fn/queues/guest-entries-controller-get-guest-entry-history';
import { bookingControllerCancelAppointment } from '../../../api/fn/queues/booking-controller-cancel-appointment';
import { SocketInvalidatedTtl } from '../../../core/caching/ttl/socket-invalidated-ttl';
import { QueueSocketService } from '../../../core/socket/queue-socket.service';
import { GuestStore } from '../../../core/guest/guest-store';
import { ToastService } from '../../../core/toast/toast.service';

@Injectable({ providedIn: 'root' })
export class GuestQueuesService {
  private readonly _http = inject(HttpClient);
  private readonly _guestStore = inject(GuestStore);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _socket = inject(QueueSocketService);
  private readonly _toast = inject(ToastService);

  private readonly _entries = signal<QueueEntry[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal(false);
  private readonly _cancelling = signal<string | null>(null);
  private _inflight = false;

  // TTL is a fallback, not the primary staleness signal — see
  // ActiveQueuesService for the full reasoning (identical here, guest-token
  // auth instead of JWT).
  private readonly _watch = new SocketInvalidatedTtl(this._socket, 30_000);

  readonly entries = this._entries.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly cancelling = this._cancelling.asReadonly();

  load(): void {
    // A visitor who has never joined a queue has no guest token, and this
    // endpoint requires one — the request could only ever 401. Returning an
    // empty list is the honest answer for "your queues" when they have none,
    // and it avoids a guaranteed-failing call on every visit to this page.
    if (!this._guestStore.hasToken()) {
      this._entries.set([]);
      this._loading.set(false);
      this._error.set(false);
      return;
    }
    if (this._inflight || this._watch.isFresh()) return;
    this._inflight = true;
    this._loading.set(true);
    this._error.set(false);
    guestEntriesControllerGetGuestEntryHistory(this._http, this._apiConfig.rootUrl, { limit: 200 })
      .pipe(retry(1))
      .subscribe({
        next: (res) => {
          this._inflight = false;
          const entries = res.body.data ?? [];
          this._entries.set(entries);
          this._loading.set(false);
          this._watch.markFetched();
          this._watch.sync(
            entries
              .filter((entry) => entry.status === 'WAITING' || entry.status === 'SERVING')
              .map((entry) => entry.queueId),
          );
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
    this._watch.invalidate();
    this.load();
  }

  cancelAppointment(entry: QueueEntry): void {
    const salonId = entry.queue?.salon?.id;
    if (!salonId || this._cancelling()) return;
    this._cancelling.set(entry.id);
    bookingControllerCancelAppointment(this._http, this._apiConfig.rootUrl, {
      salonId,
      queueId: entry.queueId,
      entryId: entry.id,
    }).subscribe({
      next: () => {
        this._cancelling.set(null);
        this._entries.update((list) =>
          list.map((item) => (item.id === entry.id ? { ...item, status: 'CANCELLED' } : item)),
        );
        this._toast.success('Appointment cancelled.');
      },
      error: () => {
        this._cancelling.set(null);
        this._toast.error('Failed to cancel — the cancellation window may have passed.');
      },
    });
  }
}
