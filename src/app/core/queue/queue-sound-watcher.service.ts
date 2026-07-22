import { Injectable, inject, effect } from '@angular/core';
import { SalonContextService } from '../salon-context/salon-context.service';
import { QueueSocketService } from '../socket/queue-socket.service';

// Keeps a barber's own queue joined for the sound notification, independent of
// which page they're on — so the chime fires from anywhere in the app, not
// only while the queue-console page happens to be mounted (which is what
// scopes QueueConsoleService's own watch).
//
// Tracks displayMembership (not the stricter route-derived membership) so the
// watch survives navigating to salon-agnostic pages like Dashboard/Account —
// see SalonContextService's doc comment on displaySalonId/displayMembership
// for why that one persists the last-visited salon across those routes. The
// watch drops on logout or switching to a salon where the user isn't staff
// (both surface as displayMembership().queueId going null).
//
// This lives in its own feature-named service — rather than inside the socket
// transport — so the transport stays a dumb pipe callers tell what to watch,
// and the "when do we watch for sound" decision has one obvious home. It's
// instantiated eagerly at app bootstrap (injected by App) and runs for the
// app's lifetime; the socket's own refcounting lets this overlap harmlessly
// with QueueConsoleService when the barber is on their own console page.
@Injectable({ providedIn: 'root' })
export class QueueSoundWatcherService {
  private readonly _salonContext = inject(SalonContextService);
  private readonly _socket = inject(QueueSocketService);

  private _watchedQueueId: string | null = null;

  constructor() {
    effect(() => {
      const queueId = this._salonContext.displayMembership()?.queueId ?? null;
      if (queueId === this._watchedQueueId) return;

      if (this._watchedQueueId) this._socket.unwatchQueue(this._watchedQueueId);
      this._watchedQueueId = queueId;
      if (queueId) {
        // connect() is idempotent — a logged-in barber usually already has the
        // socket open (AuthService opens it on login), but this must not
        // depend on that ordering.
        this._socket.connect();
        this._socket.watchQueueAsStaff(queueId);
      }
    });
  }
}
