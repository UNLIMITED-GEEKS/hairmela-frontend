import { Component, inject, signal, computed, OnInit, effect, DestroyRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ToastService } from '../../../core/toast/toast.service';
import { environment } from '../../../../environments/environment';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { SalonOverviewService } from '../salon-overview/salon-overview.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { RouteParam } from '../../../core/routing/route-paths';
import { hairmelaPosterControllerGetPoster } from '../../../api/fn/salons/hairmela-poster-controller-get-poster';

@Component({
  selector: 'app-salon-share',
  templateUrl: './salon-share.component.html',
  imports: [SkeletonComponent, PageHeaderComponent, InlineSpinnerComponent],
})
export class SalonShareComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _toast = inject(ToastService);
  private readonly _overview = inject(SalonOverviewService);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _http = inject(HttpClient);
  private readonly _destroyRef = inject(DestroyRef);

  protected readonly loading = signal(true);
  protected readonly qrDataUrl = signal('');
  protected readonly downloadingPoster = signal(false);

  // Pure derivation from the loaded salon — no side effect, so computed (not
  // effect) is the right primitive.
  protected readonly shareUrl = computed(() => {
    const slug = this._overview.salon()?.slug;
    return slug ? `${environment.appBaseUrl}/s/${slug}` : '';
  });

  // Backend generates the printable poster server-side (PDF); no client-side
  // generation (canvas/print CSS) remains. hairmelaPosterControllerGetPoster
  // .PATH is the generated client's own copy of the route template, so the
  // {slug} substitution here can't drift from the real backend path — the
  // generated FUNCTION isn't used to call it, since it's typed for JSON and
  // discards the response body (wrong shape for a binary PDF).
  protected readonly posterUrl = computed(() => {
    const slug = this._overview.salon()?.slug;
    if (!slug) return '';
    const path = hairmelaPosterControllerGetPoster.PATH.replace('{slug}', encodeURIComponent(slug));
    return `${environment.apiBaseUrl}${path}`;
  });

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  constructor() {
    effect(() => {
      const url = this.shareUrl();
      if (!url) return;
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
    const slug = this._overview.salon()?.slug;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = slug ? `hairmela-${slug}-qr.png` : 'hairmela-qr.png';
    a.click();
  }

  // Fetched as a blob rather than linked directly: the server always sends
  // Content-Disposition: inline, so an <a href> (even with `download`, which
  // browsers ignore cross-origin) opens the PDF in a tab instead of saving
  // it. Downloading the bytes ourselves and handing them to an object-URL
  // link is the only way to force a real save, per the endpoint's own
  // hand-off notes. Not routed through the generated client function, which
  // is typed for JSON and drops the body.
  protected downloadPoster(): void {
    const url = this.posterUrl();
    if (!url || this.downloadingPoster()) return;
    this.downloadingPoster.set(true);

    this._http
      .get(url, { responseType: 'blob' })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (blob) => {
          const objectUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = objectUrl;
          a.download = `HairMela - ${this._overview.salon()?.name ?? 'Salon'} - Queue Card.pdf`;
          a.click();
          URL.revokeObjectURL(objectUrl);
          this.downloadingPoster.set(false);
        },
        error: () => {
          this.downloadingPoster.set(false);
          this._toast.error('Could not download the poster. Please try again.');
        },
      });
  }

  private async _generateQr(url: string): Promise<void> {
    // qrcode is CJS — in the production ESM bundle it lands under .default
    const mod = await import('qrcode');
    const toDataURL = (mod.default as unknown as typeof mod).toDataURL ?? mod.toDataURL;
    const dataUrl = await toDataURL(url, { width: 256, margin: 2 });
    this.qrDataUrl.set(dataUrl);
  }
}
