import { Injectable, inject } from '@angular/core';
import { Location } from '@angular/common';
import { AppPlatformService } from './app-platform.service';
import { OverlayRegistry } from '../overlay/overlay-registry';
import { ConfirmDialogService } from '../../shared/components/confirm-dialog/confirm-dialog.service';
import { RenameDialogService } from '../../shared/components/rename-dialog/rename-dialog.service';

// Android hardware/gesture back button → in-app navigation.
//
// Without this the back button closes the app from ANY screen, because the
// WebView reports no navigable history to the native layer. Play Store reviews
// treat "back exits from a detail screen" as a functional defect, so this is
// required before release, not polish.
//
// WEB PAYS NOTHING FOR THIS. The Capacitor packages are loaded via dynamic
// import() inside init(), behind an environment.native check, so the bundler
// splits them into a lazy chunk that a web build never requests. A previous
// version used top-level imports and added ~8.6 kB of @capacitor/core to the
// web initial bundle — verified by the budget warning jumping from 552.78 kB
// to 561.41 kB. Do not convert these back to static imports.
//
// The guard is environment.native (a build-time constant) rather than
// Capacitor.isNativePlatform() (a runtime call) precisely because the runtime
// check would still require the module to be loaded to ask the question.
//
// Priority order when back is pressed:
//   1. An open dialog closes (matching what Escape/Cancel would do on web).
//   2. Otherwise navigate back through Angular's history.
//   3. At the last history entry, exit the app — the Android convention.
@Injectable({ providedIn: 'root' })
export class NativeBackButtonService {
  private readonly _location = inject(Location);
  private readonly _platform = inject(AppPlatformService);
  private readonly _overlays = inject(OverlayRegistry);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _renameDialog = inject(RenameDialogService);

  async init(): Promise<void> {
    if (!this._platform.isNative || this._platform.nativePlatform !== 'android') return;

    const { App: CapacitorApp } = await import('@capacitor/app');
    await CapacitorApp.addListener('backButton', () => this._onBack(CapacitorApp));
  }

  private _onBack(capacitorApp: typeof import('@capacitor/app').App): void {
    // A dialog is modal — back should dismiss it rather than navigate the page
    // underneath, which would leave the dialog orphaned over a new route.
    //
    // Registry first: it holds the input-driven dialogs (join, add-client,
    // book-appointment, gallery, gallery-edit), which are the ones that can be
    // stacked on top of everything else. The two global dialogs below are
    // singletons rendered from app.html and cannot nest inside those.
    if (this._overlays.closeTop()) return;

    if (this._confirmDialog.state()) {
      this._confirmDialog.cancel();
      return;
    }
    if (this._renameDialog.state()) {
      this._renameDialog.cancel();
      return;
    }

    // Same history check BackButtonComponent uses, for consistency. length > 1
    // means there is somewhere in-app to go back to.
    if (window.history.length > 1) {
      this._location.back();
      return;
    }

    // Nothing left in history: Android's expected behaviour at the root of the
    // task is to leave the app, not to sit on a dead button press.
    void capacitorApp.exitApp();
  }
}
