import { Component, DestroyRef, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../../api/api-configuration';
import { salonsControllerFindOne } from '../../../api/fn/salons/salons-controller-find-one';
import { ToastService } from '../../../core/toast/toast.service';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-salon-share',
  templateUrl: './salon-share.component.html',
})
export class SalonShareComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _toast = inject(ToastService);

  protected readonly loading = signal(true);
  protected readonly shareUrl = signal('');
  protected readonly qrDataUrl = signal('');

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  ngOnInit(): void {
    salonsControllerFindOne(this._http, this._apiConfig.rootUrl, { salonId: this._salonId }).pipe(
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: (res) => {
        const url = `${environment.appBaseUrl}/s/${res.body.slug}`;
        this.shareUrl.set(url);
        this._generateQr(url);
        this.loading.set(false);
      },
      error: () => {
        this._toast.error('Salon not found');
        this._router.navigate(['/dashboard']);
      },
    });
  }

  protected copyLink(): void {
    navigator.clipboard.writeText(this.shareUrl()).then(() => {
      this._toast.success('Link copied');
    }).catch(() => {
      this._toast.error('Could not copy link');
    });
  }

  protected downloadQr(): void {
    const dataUrl = this.qrDataUrl();
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'hairmela-qr.png';
    a.click();
  }

  private async _generateQr(url: string): Promise<void> {
    console.log('[QR] input url:', url);
    const mod = await import('qrcode');
    console.log('[QR] module keys:', Object.keys(mod).join(', '));
    console.log('[QR] typeof mod.toDataURL:', typeof (mod as Record<string, unknown>)['toDataURL']);
    console.log('[QR] typeof mod.default:', typeof (mod as Record<string, unknown>)['default']);
    console.log('[QR] typeof mod.default?.toDataURL:', typeof ((mod as Record<string, unknown>)['default'] as Record<string, unknown> | undefined)?.['toDataURL']);

    const fn =
      typeof (mod as Record<string, unknown>)['toDataURL'] === 'function'
        ? (mod as Record<string, unknown>)['toDataURL']
        : typeof ((mod as Record<string, unknown>)['default'] as Record<string, unknown> | undefined)?.['toDataURL'] === 'function'
          ? ((mod as Record<string, unknown>)['default'] as Record<string, unknown>)['toDataURL']
          : null;

    console.log('[QR] resolved fn:', typeof fn);

    if (!fn) {
      console.error('[QR] toDataURL not found on module');
      return;
    }

    const dataUrl = await (fn as (url: string, opts: unknown) => Promise<string>)(url, { width: 256, margin: 2 });
    console.log('[QR] dataUrl prefix:', typeof dataUrl === 'string' ? dataUrl.slice(0, 30) : String(dataUrl));
    this.qrDataUrl.set(dataUrl);
  }
}
