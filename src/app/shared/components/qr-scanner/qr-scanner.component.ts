import { Component, ElementRef, OnDestroy, inject, output, signal, viewChild } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { AppPlatformService } from '../../../core/native/app-platform.service';

// QR scanning with two implementations behind one unchanged public API
// (`scanned` / `closed`), so the only consumer — dashboard.component — needs no
// change and no knowledge of which platform it is on.
//
//   web    → html5-qrcode via getUserMedia, exactly as before. Untouched.
//   native → @capacitor-mlkit/barcode-scanning. getUserMedia is unreliable in
//            an Android WebView and does no native permission plumbing, so the
//            web library cannot be trusted there.
//
// The native scanner is a REAL CAMERA PREVIEW BEHIND THE WEBVIEW, not an
// element inside the page: the plugin renders the camera natively and the
// WebView must be made transparent to see it. That is why `nativeScanning`
// hides the normal chrome and adds `barcode-scanner-active` to <body> — the
// CSS in styles.css makes the page background transparent while it is set.
// Forgetting to remove that class leaves the whole app invisible, so every
// exit path (success, cancel, error, ngOnDestroy) must call _stopNative().
@Component({
  selector: 'app-qr-scanner',
  templateUrl: './qr-scanner.component.html',
})
export class QrScannerComponent implements OnDestroy {
  readonly scanned = output<string>();
  readonly closed = output<void>();

  private readonly _platform = inject(AppPlatformService);
  private readonly _document = inject(DOCUMENT);

  protected readonly error = signal<string | null>(null);
  protected readonly scanning = signal(false);
  /** True while the native camera is showing through a transparent WebView. */
  protected readonly nativeScanning = signal(false);
  protected readonly isNative = this._platform.isNative;

  private readonly _readerEl = viewChild<ElementRef<HTMLDivElement>>('reader');
  // Typed as unknown: html5-qrcode is only imported on the web path, so naming
  // its type here would pull the module into the native bundle.
  private _scanner: { stop(): Promise<void>; clear(): void } | null = null;
  private _handled = false;

  async ngAfterViewInit(): Promise<void> {
    await this._start();
  }

  async ngOnDestroy(): Promise<void> {
    await this._stop();
  }

  protected close(): void {
    void this._stop().then(() => this.closed.emit());
  }

  private async _start(): Promise<void> {
    this.error.set(null);
    this._handled = false;
    if (this._platform.isNative) {
      await this._startNative();
      return;
    }
    await this._startWeb();
  }

  // ── Native ────────────────────────────────────────────────────────────────

  private async _startNative(): Promise<void> {
    try {
      const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');

      if (this._platform.nativePlatform === 'android') {
        // The scanning module is a Google Play Services dependency downloaded on
        // demand, not shipped in the APK. iOS bundles ML Kit through CocoaPods,
        // and these two module-management methods are unavailable there.
        const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
        if (!available) {
          await BarcodeScanner.installGoogleBarcodeScannerModule();
        }
      }

      const { camera } = await BarcodeScanner.requestPermissions();
      if (camera !== 'granted' && camera !== 'limited') {
        this.error.set('Camera access denied. Please allow camera permission and try again.');
        return;
      }

      this.scanning.set(true);
      this.nativeScanning.set(true);
      this._document.body.classList.add('barcode-scanner-active');

      const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });

      await this._stopNative();

      // Empty array = the user backed out of the scanner without scanning.
      const value = barcodes[0]?.rawValue;
      if (!value) {
        this.closed.emit();
        return;
      }
      this._emitScanned(value);
    } catch {
      await this._stopNative();
      this.error.set('Could not start the camera. Please try again.');
    }
  }

  private async _stopNative(): Promise<void> {
    this.nativeScanning.set(false);
    this.scanning.set(false);
    this._document.body.classList.remove('barcode-scanner-active');
    try {
      const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');
      await BarcodeScanner.stopScan();
    } catch {
      /* not scanning */
    }
  }

  // ── Web (unchanged behaviour) ─────────────────────────────────────────────

  private async _startWeb(): Promise<void> {
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const el = this._readerEl();
      if (!el) return;

      const scanner = new Html5Qrcode(el.nativeElement.id);
      this._scanner = scanner;
      this.scanning.set(true);

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (text) => this._emitScanned(text),
        () => {},
      );
    } catch {
      this.scanning.set(false);
      this.error.set('Camera access denied. Please allow camera permission and try again.');
    }
  }

  private async _stop(): Promise<void> {
    if (this._platform.isNative) {
      await this._stopNative();
      return;
    }
    if (this._scanner) {
      try {
        await this._scanner.stop();
        this._scanner.clear();
      } catch {
        /* already stopped */
      }
      this._scanner = null;
    }
    this.scanning.set(false);
  }

  private _emitScanned(text: string): void {
    if (this._handled) return;
    this._handled = true;
    void this._stop().then(() => this.scanned.emit(text));
  }
}
