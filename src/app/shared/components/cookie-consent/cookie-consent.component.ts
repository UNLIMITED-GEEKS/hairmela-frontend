import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PersistentStore } from '../../../core/storage/persistent-store';
import { RoutePath } from '../../../core/routing/route-paths';
import {
  COOKIE_CONSENT_KEY,
  CookieChoice,
  MetaPixelService,
} from '../../../core/analytics/meta-pixel.service';
import { TikTokPixelService } from '../../../core/analytics/tiktok-pixel.service';

interface CookieCategory {
  readonly title: string;
  readonly description: string;
  readonly examples: string;
  readonly locked: boolean;
}

// Cookie-consent banner. HairMela stores a guest token + active-queue entries in
// localStorage so a signed-out visitor can join a queue and keep their position
// across reloads — that's the consent we're asking for. Shown once: it stays
// until the user accepts or rejects, then the choice persists and it never
// reappears. Rendered app-wide from the root so it covers every shell.
@Component({
  selector: 'app-cookie-consent',
  templateUrl: './cookie-consent.component.html',
  imports: [RouterLink],
})
export class CookieConsentComponent {
  private readonly _store = inject(PersistentStore);
  private readonly _metaPixel = inject(MetaPixelService);
  private readonly _tiktokPixel = inject(TikTokPixelService);

  // Visible only when no prior choice is stored.
  protected readonly visible = signal(this._store.get<CookieChoice>(COOKIE_CONSENT_KEY) === null);

  protected readonly privacyLink = RoutePath.privacy();

  protected readonly categories: readonly CookieCategory[] = [
    {
      title: 'Necessary cookies',
      description: 'Essential for the site to work properly. These cannot be disabled.',
      examples: 'Session storage, authentication, your spot in a queue, security.',
      locked: true,
    },
    {
      title: 'Analytics cookies',
      description: 'Help us understand how visitors use HairMela so we can improve it.',
      examples: 'Usage statistics, performance monitoring.',
      locked: false,
    },
    {
      title: 'Marketing cookies',
      description: 'Used to measure campaigns and show relevant content.',
      examples: 'Meta Pixel, TikTok Pixel, ad measurement, retargeting.',
      locked: false,
    },
  ];

  protected accept(): void {
    this._choose('accepted');
  }

  protected reject(): void {
    this._choose('rejected');
  }

  private _choose(choice: CookieChoice): void {
    this._store.set<CookieChoice>(COOKIE_CONSENT_KEY, choice);
    this._metaPixel.init();
    this._tiktokPixel.init();
    this.visible.set(false);
  }
}
