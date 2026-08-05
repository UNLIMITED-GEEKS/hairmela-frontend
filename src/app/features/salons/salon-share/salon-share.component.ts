import { Component, inject, signal, computed, OnInit, effect } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ToastService } from '../../../core/toast/toast.service';
import { environment } from '../../../../environments/environment';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { SalonOverviewService } from '../salon-overview/salon-overview.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { RouteParam } from '../../../core/routing/route-paths';
import { hairmelaPosterControllerGetPoster } from '../../../api/fn/salons/hairmela-poster-controller-get-poster';

@Component({
  selector: 'app-salon-share',
  templateUrl: './salon-share.component.html',
  imports: [SkeletonComponent, PageHeaderComponent],
})
export class SalonShareComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _toast = inject(ToastService);
  private readonly _overview = inject(SalonOverviewService);
  private readonly _currentUser = inject(CurrentUserStore);

  protected readonly loading = signal(true);
  protected readonly qrDataUrl = signal('');

  // Pure derivation from the loaded salon — no side effect, so computed (not
  // effect) is the right primitive.
  protected readonly shareUrl = computed(() => {
    const slug = this._overview.salon()?.slug;
    return slug ? `${environment.appBaseUrl}/s/${slug}` : '';
  });

  // Backend now generates the printable poster server-side (PDF) — this just
  // links straight at it, per the hand-off's own guidance ("not JSON, don't
  // call it through the normal API client, point a link at the URL
  // directly"). hairmelaPosterControllerGetPoster.PATH is the generated
  // client's own copy of the route template, so the {slug} substitution here
  // can't drift from the real backend path even though the generated
  // function itself isn't used to call it (it's typed for HttpClient/JSON,
  // discards the body — wrong shape for a binary PDF response opened directly
  // in a new tab). No more client-side poster generation (canvas/print CSS)
  // at all — the whole print-only DOM block and its .scss are gone.
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
