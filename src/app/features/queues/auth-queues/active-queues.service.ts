import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { retry } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { QueueEntry } from '../../../api/models/queue-entry';
import { myEntriesControllerGetMyEntries } from '../../../api/fn/queues/my-entries-controller-get-my-entries';
import { bookingControllerCancelAppointment } from '../../../api/fn/queues/booking-controller-cancel-appointment';
import { SocketInvalidatedTtl } from '../../../core/caching/ttl/socket-invalidated-ttl';
import { QueueSocketService } from '../../../core/socket/queue-socket.service';
import { ToastService } from '../../../core/toast/toast.service';

@Injectable({ providedIn: 'root' })
export class ActiveQueuesService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _socket = inject(QueueSocketService);
  private readonly _toast = inject(ToastService);

  private readonly _entries = signal<QueueEntry[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal(false);
  private readonly _cancelling = signal<string | null>(null);
  private _inflight = false;
  // Set when refresh() is called while a load() is already in flight — that
  // in-flight request was started before whatever triggered the refresh (e.g.
  // a just-completed booking), so it will land without the new data. Without
  // this, refresh()'s load() call is silently dropped by the _inflight guard
  // below, and nothing re-fetches until the 30s TTL fallback expires (the
  // "appears after a delay" bug: book an appointment → navigate to My Queues
  // → its ngOnInit load() starts and is still running when the booking POST
  // resolves and calls refresh()).
  //
  // This makes that recovery reliable, but the race itself lives at the
  // booking call site — see the FIXME in book-appointment-dialog.component.ts's
  // confirmBooking(), which navigates here before its POST resolves.
  // Note this is a single boolean, not a generation counter: concurrent
  // invalidations arriving during one in-flight fetch collapse into one
  // follow-up refresh. Sufficient for the flows that call refresh() today.
  private _refreshPending = false;

  // TTL is a fallback, not the primary staleness signal — SocketInvalidatedTtl
  // invalidates immediately when any of the user's active entries gets
  // called. The 15s window only matters when the socket never told us
  // anything changed (disconnected, missed an event, or zero active entries).
  // CLAUDE.md's "never cache live queue state" rule is why it stays short
  // instead of being removed outright.
  private readonly _watch = new SocketInvalidatedTtl(this._socket, 30_000);

  readonly entries = this._entries.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly cancelling = this._cancelling.asReadonly();

  load(): void {
    if (this._inflight) return;
    if (this._watch.isFresh()) return;
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
          this._watch.markFetched();
          this._watch.sync(res.body.map((e) => e.queueId));
          if (this._refreshPending) {
            this._refreshPending = false;
            this.refresh();
          }
        },
        error: () => {
          this._inflight = false;
          this._error.set(true);
          this._loading.set(false);
          if (this._refreshPending) {
            this._refreshPending = false;
            this.refresh();
          }
        },
      });
  }

  /** Bypasses the TTL — call after an action that changes this list (e.g. leaving a queue). */
  refresh(): void {
    if (this._inflight) {
      this._refreshPending = true;
      return;
    }
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
        this._entries.update((list) => list.filter((e) => e.id !== entry.id));
        this._toast.success('Appointment cancelled.');
      },
      error: () => {
        this._cancelling.set(null);
        this._toast.error('Failed to cancel — the cancellation window may have passed.');
      },
    });
  }
}
