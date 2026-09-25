import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { AppPlatformService } from '../native/app-platform.service';

/** Device/browser network reachability, shared by global and live-update UI. */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  private readonly _document = inject(DOCUMENT);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _platform = inject(AppPlatformService);
  private readonly _online = signal(true);

  readonly online = this._online.asReadonly();

  constructor() {
    const window = this._document.defaultView;
    if (!window) return;

    this._online.set(window.navigator.onLine);

    if (this._platform.isNative) {
      void this._listenNative();
      return;
    }

    this._listenBrowser(window);
  }

  private async _listenNative(): Promise<void> {
    try {
      const { Network } = await import('@capacitor/network');
      const status = await Network.getStatus();
      this._online.set(status.connected);

      const listener = await Network.addListener('networkStatusChange', ({ connected }) => {
        this._online.set(connected);
      });
      this._destroyRef.onDestroy(() => void listener.remove());
    } catch {
      const window = this._document.defaultView;
      if (window) this._listenBrowser(window);
    }
  }

  private _listenBrowser(window: Window): void {
    const update = () => this._online.set(window.navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    this._destroyRef.onDestroy(() => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    });
  }
}
