import { ApplicationRef, Injectable, inject } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { concat, interval } from 'rxjs';
import { first, filter } from 'rxjs/operators';
import { ToastService } from '../toast/toast.service';

const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes — a customer watching a live queue shouldn't sit long on stale code
const RELOAD_DELAY_MS = 4000; // matches ToastService's auto-dismiss, so the toast is seen before reload

// FIXME: as the user base grows, replace the every-10-minutes background poll
// with a user-initiated update. Each open tab hits ngsw.json on the interval —
// cheap per client, but it scales linearly with concurrent users, and the
// silent auto-reload can interrupt someone mid-interaction. The better pattern
// at scale: keep listening for VERSION_READY, but instead of auto-reloading,
// show a persistent "New version available — Reload" banner/button and let the
// user choose when. That drops the polling cost (check on demand / on
// visibilitychange) and removes the surprise reload.
// Watches Angular's service worker for a newly-deployed version. Angular
// downloads the new build in the background and emits VERSION_READY when it's
// ready to swap in — without this, the swap only happens on the user's *next*
// reload, which is the "I have to refresh a few times to get the new version"
// symptom. Here we surface an info toast then reload automatically, so a
// single visit picks up the deploy instead of needing manual refreshes.
//
// No-op under `ng serve` (provideServiceWorker is enabled only in prod builds,
// so SwUpdate.isEnabled is false) — every path guards on isEnabled.
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly _swUpdate = inject(SwUpdate);
  private readonly _appRef = inject(ApplicationRef);
  private readonly _toast = inject(ToastService);

  init(): void {
    if (!this._swUpdate.isEnabled) return;

    // New version downloaded and ready → tell the user, then reload into it.
    this._swUpdate.versionUpdates
      .pipe(
        filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this._toast.info('Updating to the latest version…');
        setTimeout(() => {
          void this._swUpdate.activateUpdate().then(() => document.location.reload());
        }, RELOAD_DELAY_MS);
      });

    // Actively poll for updates: once the app is stable, then every 6h. Angular
    // otherwise only checks on a full page load, so a long-lived tab (a barber
    // with the queue console open all day) would never learn about a deploy.
    const appStable$ = this._appRef.isStable.pipe(first((stable) => stable === true));
    concat(appStable$, interval(UPDATE_CHECK_INTERVAL_MS))
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        this._swUpdate.checkForUpdate().catch(() => {
          /* transient network failure — the next interval retries */
        });
      });

    // A corrupted/unrecoverable SW cache would otherwise strand the user on a
    // broken app with no way out. Hard-reload to let the browser re-fetch a
    // clean worker.
    this._swUpdate.unrecoverable.pipe(takeUntilDestroyed()).subscribe(() => {
      this._toast.error('Something went wrong loading the app. Reloading…');
      setTimeout(() => document.location.reload(), RELOAD_DELAY_MS);
    });
  }
}
