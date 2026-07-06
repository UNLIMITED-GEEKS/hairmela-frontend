import { Component, ElementRef, OnDestroy, output, signal, viewChild } from '@angular/core';
import { Html5Qrcode } from 'html5-qrcode';

@Component({
  selector: 'app-qr-scanner',
  templateUrl: './qr-scanner.component.html',
})
export class QrScannerComponent implements OnDestroy {
  readonly scanned = output<string>();
  readonly closed = output<void>();

  protected readonly error = signal<string | null>(null);
  protected readonly scanning = signal(false);

  private readonly _readerEl = viewChild.required<ElementRef<HTMLDivElement>>('reader');
  private _scanner: Html5Qrcode | null = null;
  private _handled = false;

  async ngAfterViewInit(): Promise<void> {
    await this._start();
  }

  async ngOnDestroy(): Promise<void> {
    await this._stop();
  }

  protected close(): void {
    this.closed.emit();
  }

  private async _start(): Promise<void> {
    this.error.set(null);
    this._handled = false;

    try {
      this._scanner = new Html5Qrcode(this._readerEl().nativeElement.id);
      this.scanning.set(true);

      await this._scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (text) => this._onScan(text),
        () => {},
      );
    } catch {
      this.scanning.set(false);
      this.error.set('Camera access denied. Please allow camera permission and try again.');
    }
  }

  private async _stop(): Promise<void> {
    if (this._scanner) {
      try {
        await this._scanner.stop();
        this._scanner.clear();
      } catch { /* already stopped */ }
      this._scanner = null;
    }
    this.scanning.set(false);
  }

  private async _onScan(text: string): Promise<void> {
    if (this._handled) return;
    this._handled = true;
    await this._stop();
    this.scanned.emit(text);
  }
}
