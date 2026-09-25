import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { ConnectivityService } from '../../../core/connectivity/connectivity.service';

type BannerState = 'hidden' | 'offline' | 'restored';
const RESTORED_VISIBLE_MS = 3000;

@Component({
  selector: 'app-offline-banner',
  templateUrl: './offline-banner.component.html',
})
export class OfflineBannerComponent {
  private readonly _connectivity = inject(ConnectivityService);
  private readonly _destroyRef = inject(DestroyRef);
  private _hideTimer: ReturnType<typeof setTimeout> | null = null;
  private _wasOnline = this._connectivity.online();

  protected readonly state = signal<BannerState>(this._wasOnline ? 'hidden' : 'offline');

  constructor() {
    effect(() => {
      const online = this._connectivity.online();
      if (!online) {
        this._clearTimer();
        this.state.set('offline');
      } else if (!this._wasOnline) {
        this.state.set('restored');
        this._clearTimer();
        this._hideTimer = setTimeout(() => this.state.set('hidden'), RESTORED_VISIBLE_MS);
      }
      this._wasOnline = online;
    });
    this._destroyRef.onDestroy(() => this._clearTimer());
  }

  private _clearTimer(): void {
    if (this._hideTimer === null) return;
    clearTimeout(this._hideTimer);
    this._hideTimer = null;
  }
}
