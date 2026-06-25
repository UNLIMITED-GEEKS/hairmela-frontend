import { Injectable, inject } from '@angular/core';
import { GuestStore } from './guest-store';
import { GuestHttpService } from './guest-http.service';

@Injectable({ providedIn: 'root' })
export class GuestEntryValidatorService {
  private readonly _guestStore = inject(GuestStore);
  private readonly _guestHttp = inject(GuestHttpService);

  validate(): void {
    if (!this._guestStore.hasToken()) return;

    this._guestHttp.getGuestEntries().subscribe({
      next: (entries) => {
        const liveIds = entries.map((e) => e.id);
        this._guestStore.syncEntries(liveIds);
      },
      // Silent on error — localStorage entries are still usable as a fallback
    });
  }
}
