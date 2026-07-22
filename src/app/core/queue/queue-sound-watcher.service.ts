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
//
// **FIXME (known bug, not yet root-caused): in practice the chime is still
// only heard after visiting the queue-console page at least once — landing
// straight on a page like Salon Overview and never opening the console gets
// the OS push notification but NOT the in-app sound, even though this
// service's watch should be independent of the console page entirely. Root
// cause not yet found (candidates: this effect firing before the socket/
// membership are actually ready on a cold load, or a change-detection timing
// gap that only gets flushed by the extra navigation/HTTP activity visiting
// the console causes). Revisit with console.log tracing on effect firing +
// _maybePlaySound + the socket's connect/disconnect events to find the real
// break point before attempting another fix.**
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
