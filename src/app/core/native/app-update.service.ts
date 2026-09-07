import { Injectable, inject, signal } from '@angular/core';
import { AppPlatformService } from './app-platform.service';

// Forced update gate for the Play Store build.
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

  /**
   * True while a required update is outstanding — drives the blocking overlay.
   *
   * Stays true if the user dismisses Google's sheet: they cannot back out of
   * the requirement, only out of the flow, and the overlay's button lets them
   * start it again.
   */
  private readonly _updateRequired = signal(false);
  readonly updateRequired = this._updateRequired.asReadonly();

  async init(): Promise<void> {
    if (!this._platform.isNative) return;

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
      await this.startUpdate();
    } catch {
      // Deliberately silent — see above.
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
      await AppUpdate.performImmediateUpdate();
    } catch {
      // Dismissed or failed. _updateRequired stays true, so the overlay
      // remains and they can try again.
    }
  }
}
