import { Component, inject, signal, OnInit, effect } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ToastService } from '../../../core/toast/toast.service';
import { environment } from '../../../../environments/environment';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { SalonOverviewService } from '../salon-overview/salon-overview.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';

@Component({
  selector: 'app-salon-share',
  templateUrl: './salon-share.component.html',
  imports: [SkeletonComponent],
})
export class SalonShareComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _toast = inject(ToastService);
  private readonly _overview = inject(SalonOverviewService);
  private readonly _currentUser = inject(CurrentUserStore);

  protected readonly loading = signal(true);
  protected readonly shareUrl = signal('');
  protected readonly qrDataUrl = signal('');

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  constructor() {
    effect(() => {
      const salon = this._overview.salon();
      if (!salon?.slug) return;
      const url = `${environment.appBaseUrl}/s/${salon.slug}`;
      this.shareUrl.set(url);
      this._generateQr(url);
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

  private async _generateQr(url: string): Promise<void> {
    // qrcode is CJS — in the production ESM bundle it lands under .default
    const mod = await import('qrcode');
    const toDataURL = (mod.default as unknown as typeof mod).toDataURL ?? mod.toDataURL;
    const dataUrl = await toDataURL(url, { width: 256, margin: 2 });
    this.qrDataUrl.set(dataUrl);
  }
}
