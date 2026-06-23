import { Component, DestroyRef, OnDestroy, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterOutlet, ActivatedRoute } from '@angular/router';
import { SalonVisitService } from '../salon-visit.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { ConnectionBannerComponent } from '../../../shared/components/connection-banner/connection-banner.component';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

@Component({
  selector: 'app-salon-shell',
  templateUrl: './salon-shell.component.html',
  providers: [SalonVisitService],
  imports: [RouterOutlet, SkeletonComponent, ConnectionBannerComponent],
})
export class SalonShellComponent implements OnInit, OnDestroy {
  protected readonly visit = inject(SalonVisitService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _platformId = inject(PLATFORM_ID);

  private _installPrompt: BeforeInstallPromptEvent | null = null;
  protected readonly canInstall = this.visit.canInstall;

  ngOnInit(): void {
    const slug = this._route.snapshot.paramMap.get('slug') ?? '';
    this.visit.init(slug);

    if (isPlatformBrowser(this._platformId)) {
      this._patchManifestStartUrl(slug);
      const handler = (e: Event) => {
        e.preventDefault();
        this._installPrompt = e as BeforeInstallPromptEvent;
        this.visit.canInstall.set(true);
      };
      window.addEventListener('beforeinstallprompt', handler);
      window.addEventListener('appinstalled', () => this.visit.canInstall.set(false));
    }
  }

  ngOnDestroy(): void {
    this.visit.destroy();
    this._restoreManifest();
  }

  protected installApp(): void {
    if (!this._installPrompt) return;
    this._installPrompt.prompt();
    this._installPrompt.userChoice.then(() => {
      this._installPrompt = null;
      this.visit.canInstall.set(false);
    });
  }

  private _patchManifestStartUrl(slug: string): void {
    const startUrl = slug ? `/s/${slug}` : '/';
    const manifestEl = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!manifestEl) return;
    fetch(manifestEl.href)
      .then((r) => r.json())
      .then((manifest: Record<string, unknown>) => {
        const patched = { ...manifest, start_url: startUrl, scope: '/' };
        const blob = new Blob([JSON.stringify(patched)], { type: 'application/manifest+json' });
        const url = URL.createObjectURL(blob);
        manifestEl.setAttribute('data-original-href', manifestEl.href);
        manifestEl.href = url;
      })
      .catch(() => {});
  }

  private _restoreManifest(): void {
    const manifestEl = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const original = manifestEl?.getAttribute('data-original-href');
    if (manifestEl && original) {
      URL.revokeObjectURL(manifestEl.href);
      manifestEl.href = original;
      manifestEl.removeAttribute('data-original-href');
    }
  }
}
