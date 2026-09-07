import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AppPlatformService } from './app-platform.service';
import { ApiConfiguration } from '../../api/api-configuration';
import { appConfigControllerGetConfig } from '../../api/fn/app-config/app-config-controller-get-config';

// Update prompt for the Play Store build.
//
// WHY GOOGLE'S FLOW RATHER THAN OUR OWN VERSION CHECK: Play already knows what
// is published and what this device has installed, so there is nothing to keep
// in sync — no min-version endpoint to remember to bump, and no way for the
// two to disagree. The IMMEDIATE flow is Google's own full-screen updater: it
// downloads and installs in place, and the user never has to find the store
// listing.
//
// PRIORITY DECIDES WHETHER IT BLOCKS. updatePriority is set per-release in the
// Play Developer API (0-5, default 0). Only a release published at
// FORCE_UPDATE_MIN_PRIORITY or above blocks; everything below is left alone, so
// an ordinary release does not interrupt anyone. Set the priority when you
// publish the release that actually needs it.
//
// ANDROID ONLY IN PRACTICE. The plugin exposes getAppUpdateInfo on iOS too, but
// there is no equivalent in-place update flow there — App Store policy owns
// that — so this service does nothing outside the Capacitor Android build.
//
// WEB PAYS NOTHING. The plugin is behind a dynamic import() inside an isNative
// guard, so the bundler splits it into a lazy chunk a web build never requests
// — the rule NativeBackButtonService documents at length. Do not convert this
// to a static import.

/**
 * Minimum Play "in-app update priority" that forces the blocking flow.
 *
 * At 3, releases published at 0-2 ship quietly and 3-5 block. Set per-release
 * in the Play Developer API (inAppUpdatePriority) — it cannot be set from the
 * Play Console UI, and it cannot be changed after a release is rolled out.
 */
const FORCE_UPDATE_MIN_PRIORITY = 3;

/** Play's own enum value for "an update is available". */
const UPDATE_AVAILABLE = 2;

@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly _platform = inject(AppPlatformService);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);

  /**
   * True while an update is outstanding — drives the overlay.
   *
   * Dismissing GOOGLE'S SHEET does not clear this: backing out of the update
   * flow is not the same as dismissing the prompt, so the overlay stays and
   * its button can restart it. Only dismiss() below clears it, and only for
   * the current run.
   */
  private readonly _updateRequired = signal(false);
  readonly updateRequired = this._updateRequired.asReadonly();

  /**
   * Hides the overlay for the rest of this run.
   *
   * IN MEMORY ONLY, deliberately — nothing is persisted, so the next launch
   * re-runs the check and the overlay comes back. That is the whole design:
   * it nags without trapping. Someone mid-way through serving a client can
   * close it and finish, and is asked again every time they reopen the app.
   *
   * Persisting the dismissal would turn "please update" into "asked once,
   * never again", which defeats a gate meant for releases that matter.
   */
  dismiss(): void {
    this._updateRequired.set(false);
  }

  /**
   * NOTHING HERE IS AWAITED BY BOOTSTRAP.
   *
   * This runs from a provideAppInitializer, which blocks the app from
   * rendering until its promise resolves — so an awaited HTTP call here would
   * hold the whole app behind /v1/app-config on a slow connection. The same
   * trap session-init.ts documents for its own background getMe.
   *
   * The check is fire-and-forget instead: init() returns immediately, the app
   * boots, and the overlay appears a moment later if either gate says so. An
   * outdated build being usable for one extra second is not the failure this
   * feature exists to prevent.
   */
  init(): void {
    if (!this._platform.isNative) return;
    void this._check();
  }

  private async _check(): Promise<void> {
    // TWO INDEPENDENT REASONS TO BLOCK, one signal.
    //
    // The server gate is checked first because it is the one we control
    // outright: raising MIN_ANDROID_VERSION_CODE gates every old build
    // immediately, with no republish. Play's own priority can only be set at
    // release time through the Publishing API and cannot be changed
    // afterwards, so it cannot answer "block this build, starting now".
    //
    // Either being true is enough — they are checked in sequence, not as
    // alternatives.
    if (await this._isBelowServerMinimum()) {
      this._updateRequired.set(true);
    }

    const { AppUpdate } = await import('@capawesome/capacitor-app-update');

    // Failure here must never block the app: no Play Services, a sideloaded
    // build, or an offline device all throw, and none of them are a reason to
    // stop someone using HairMela.
    try {
      const info = await AppUpdate.getAppUpdateInfo();
      if (info.updateAvailability !== UPDATE_AVAILABLE) return;
      if (!info.immediateUpdateAllowed) return;
      if ((info.updatePriority ?? 0) < FORCE_UPDATE_MIN_PRIORITY) return;

      this._updateRequired.set(true);
    } catch {
      // Deliberately silent — see above.
    }

    // Launched last so it runs for EITHER reason: a build gated by the server
    // still gets Google's in-place updater rather than only the overlay.
    if (this._updateRequired()) await this.startUpdate();
  }

  /**
   * True when this build's versionCode is below the server's minimum.
   *
   * FAILS OPEN. An unreachable or malformed config must never lock anyone out
   * of the app — a config outage is not a reason to stop someone running a
   * queue. Anything unexpected returns false and the Play check below still
   * gets its say.
   */
  private async _isBelowServerMinimum(): Promise<boolean> {
    try {
      const { App } = await import('@capacitor/app');
      // `build` is Android's versionCode, but typed as a string by the plugin.
      const current = Number.parseInt((await App.getInfo()).build, 10);
      if (!Number.isFinite(current)) return false;

      const res = await firstValueFrom(
        appConfigControllerGetConfig(this._http, this._apiConfig.rootUrl),
      );
      const min = res.body?.minAndroidVersionCode;
      if (typeof min !== 'number' || !Number.isFinite(min)) return false;

      return current < min;
    } catch {
      return false;
    }
  }

  /**
   * Runs Google's blocking update flow. Also called by the overlay's button,
   * for the case where the user dismissed the sheet the first time.
   */
  async startUpdate(): Promise<void> {
    if (!this._platform.isNative) return;
    const { AppUpdate } = await import('@capawesome/capacitor-app-update');
    try {
      // In-place first: Google's own full-screen updater installs without
      // leaving the app, so the user never has to find the store listing.
      await AppUpdate.performImmediateUpdate();
    } catch {
      // FALLS BACK TO THE STORE, which matters most for the server gate:
      // raising MIN_ANDROID_VERSION_CODE can block a build before Play has
      // staged the new release on that device, and performImmediateUpdate
      // throws in that case. Without this the overlay's only button would do
      // nothing and the user would be stuck with no way forward.
      //
      // Also covers a dismissed sheet — reopening the listing is a reasonable
      // second answer to "Update now".
      try {
        await AppUpdate.openAppStore();
      } catch {
        // Nothing left to try. _updateRequired stays true, so the overlay
        // remains and the button can be pressed again.
      }
    }
  }
}
