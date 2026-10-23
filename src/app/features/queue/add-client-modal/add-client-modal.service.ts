import { Injectable, computed, signal } from '@angular/core';

export type AddClientMode = 'walk-in' | 'appointment';

export interface AddClientTarget {
  readonly salonId: string;
  readonly queueId: string;
  readonly staffId: string;
  /** Names the queue's barber in the success toast, when known. */
  readonly staffName?: string;
}

export interface AddClientRequest extends AddClientTarget {
  readonly mode: AddClientMode;
}

/**
 * Opens the add-client modal from anywhere (bottom-nav "+", sidebar, mobile
 * sheet, salon overview, appointments list, the queue page's own button) and
 * decides WHICH shell hosts it.
 *
 * The modal adds through a QueueConsoleService, which paints the new client as
 * an optimistic temp row in its own timeline. QueueConsoleService is provided
 * per shell, so the host decides whose timeline gets that row:
 *
 * - The queue shell, when it is showing the requested queue. The add then
 *   paints into the console the barber is looking at. Hosting it in the auth
 *   shell instead painted into a second, unrendered console, so the page
 *   showed nothing until the server's socket frame arrived.
 * - The auth shell otherwise, on its own console.
 *
 * pageRequest and shellRequest are complements of one request, so exactly one
 * host renders it. If the queue page opens or closes while the modal is up, the
 * modal moves to the other host.
 */
@Injectable({ providedIn: 'root' })
export class AddClientModalService {
  private readonly _request = signal<AddClientRequest | null>(null);
  private readonly _pageQueueId = signal<string | null>(null);

  /** For the queue shell: the request it must host, if any. */
  readonly pageRequest = computed(() => {
    const request = this._request();
    return request && request.queueId === this._pageQueueId() ? request : null;
  });

  /** For the auth shell: the request no open queue page can host. */
  readonly shellRequest = computed(() => {
    const request = this._request();
    return request && request.queueId !== this._pageQueueId() ? request : null;
  });

  openWalkIn(target: AddClientTarget): void {
    this._request.set({ ...target, mode: 'walk-in' });
  }

  openAppointment(target: AddClientTarget): void {
    this._request.set({ ...target, mode: 'appointment' });
  }

  close(): void {
    this._request.set(null);
  }

  /** Called by the queue shell for as long as it shows this queue. */
  attachPage(queueId: string): void {
    this._pageQueueId.set(queueId);
  }

  detachPage(queueId: string): void {
    if (this._pageQueueId() === queueId) this._pageQueueId.set(null);
  }
}
