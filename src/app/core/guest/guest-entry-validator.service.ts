import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../api/api-configuration';
import { guestEntriesControllerGetGuestEntries } from '../../api/fn/queues/guest-entries-controller-get-guest-entries';
import { GuestStore } from './guest-store';
import { ActiveEntryStore } from '../queue/active-entry.store';

@Injectable({ providedIn: 'root' })
export class GuestEntryValidatorService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _guestStore = inject(GuestStore);
  private readonly _activeEntryStore = inject(ActiveEntryStore);

  validate(): void {
    if (!this._guestStore.hasToken()) return;

    guestEntriesControllerGetGuestEntries(this._http, this._apiConfig.rootUrl).subscribe({
      next: (res) => {
        const liveIds = res.body.map((e) => e.id);
        this._activeEntryStore.syncEntries(liveIds);
      },
      // Silent on error — stored entries are still usable as a fallback
    });
  }
}
