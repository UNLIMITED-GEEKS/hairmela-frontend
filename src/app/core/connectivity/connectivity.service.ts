import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { AppPlatformService } from '../native/app-platform.service';

const INTERNET_CHECK_URL = 'https://connectivitycheck.gstatic.com/generate_204';
const INTERNET_CHECK_INTERVAL_MS = 30_000;
const INTERNET_CHECK_TIMEOUT_MS = 5_000;

/** Device/browser network reachability, shared by global and live-update UI. */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  private readonly _document = inject(DOCUMENT);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _platform = inject(AppPlatformService);
  private readonly _online = signal(true);
  private _networkAvailable = true;
  private _checkGeneration = 0;
  private _checkInFlight = false;

  readonly online = this._online.asReadonly();

  constructor() {
    const window = this._document.defaultView;
    if (!window) return;

    this._networkAvailable = window.navigator.onLine;
    this._online.set(this._networkAvailable);
    if (this._networkAvailable) void this._checkInternetAccess();

    const checkTimer = window.setInterval(() => {
      if (!this._document.hidden && this._networkAvailable) void this._checkInternetAccess();
    }, INTERNET_CHECK_INTERVAL_MS);
    const checkWhenVisible = () => {
      if (!this._document.hidden && this._networkAvailable) void this._checkInternetAccess();
    };
    this._document.addEventListener('visibilitychange', checkWhenVisible);
    this._destroyRef.onDestroy(() => {
      window.clearInterval(checkTimer);
      this._document.removeEventListener('visibilitychange', checkWhenVisible);
    });

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
      this._handleNetworkAvailability(status.connected);

      const listener = await Network.addListener('networkStatusChange', ({ connected }) => {
        this._handleNetworkAvailability(connected);
      });
      this._destroyRef.onDestroy(() => void listener.remove());
    } catch {
      const window = this._document.defaultView;
      if (window) this._listenBrowser(window);
    }
  }

  private _listenBrowser(window: Window): void {
    const update = () => this._handleNetworkAvailability(window.navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    this._destroyRef.onDestroy(() => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    });
  }

  private _handleNetworkAvailability(available: boolean): void {
    this._networkAvailable = available;
    this._checkGeneration += 1;

    if (!available) {
      this._online.set(false);
      return;
    }

    void this._checkInternetAccess();
  }

  private async _checkInternetAccess(): Promise<void> {
    if (this._checkInFlight || !this._networkAvailable) return;

    this._checkInFlight = true;
    const generation = this._checkGeneration;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), INTERNET_CHECK_TIMEOUT_MS);

    try {
      await fetch(INTERNET_CHECK_URL, {
        cache: 'no-store',
        mode: 'no-cors',
        signal: controller.signal,
      });
      if (generation === this._checkGeneration && this._networkAvailable) {
        this._online.set(true);
      }
    } catch {
      if (generation === this._checkGeneration) this._online.set(false);
    } finally {
      clearTimeout(timeout);
      this._checkInFlight = false;
      if (generation !== this._checkGeneration && this._networkAvailable) {
        void this._checkInternetAccess();
      }
    }
  }
}
