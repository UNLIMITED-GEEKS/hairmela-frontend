import { Component, inject, signal, computed, OnInit, effect } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ToastService } from '../../../core/toast/toast.service';
import { environment } from '../../../../environments/environment';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { SalonOverviewService } from '../salon-overview/salon-overview.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';

@Component({
  selector: 'app-salon-share',
  templateUrl: './salon-share.component.html',
  styleUrl: './salon-share.component.scss',
  imports: [SkeletonComponent],
})
export class SalonShareComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _toast = inject(ToastService);
  private readonly _overview = inject(SalonOverviewService);
  private readonly _currentUser = inject(CurrentUserStore);

  protected readonly loading = signal(true);
  protected readonly qrDataUrl = signal('');
  protected readonly posterQrDataUrl = signal('');

  protected readonly salonName = computed(() => this._overview.salon()?.name ?? '');

  // Pure derivation from the loaded salon — no side effect, so computed (not
  // effect) is the right primitive.
  protected readonly shareUrl = computed(() => {
    const slug = this._overview.salon()?.slug;
    return slug ? `${environment.appBaseUrl}/s/${slug}` : '';
  });

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  constructor() {
    effect(() => {
      const url = this.shareUrl();
      if (!url) return;
      this._generateQr(url);
      this._generatePosterQr(url);
      this.loading.set(false);
    });
  }

  ngOnInit(): void {
    const userId = this._currentUser.user()?.id ?? '';
    this._overview.load(this._salonId, userId);
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

  protected printPoster(): void {
    window.print();
  }

  private async _generateQr(url: string): Promise<void> {
    // qrcode is CJS — in the production ESM bundle it lands under .default
    const mod = await import('qrcode');
    const toDataURL = (mod.default as unknown as typeof mod).toDataURL ?? mod.toDataURL;
    const dataUrl = await toDataURL(url, { width: 256, margin: 2 });
    this.qrDataUrl.set(dataUrl);
  }

  // Larger + higher error-correction than the on-screen/downloadable QR — this
  // one is meant to be printed and scanned from a few feet away on a poster.
  private async _generatePosterQr(url: string): Promise<void> {
    const mod = await import('qrcode');
    const toDataURL = (mod.default as unknown as typeof mod).toDataURL ?? mod.toDataURL;
    const dataUrl = await toDataURL(url, { width: 480, margin: 2, errorCorrectionLevel: 'H' });
    this.posterQrDataUrl.set(dataUrl);
  }
}
