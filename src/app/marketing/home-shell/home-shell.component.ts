import { Component, inject } from '@angular/core';
import { AppPlatformService } from '../../core/native/app-platform.service';
import { LandingComponent } from '../landing/landing.component';
import { AppHomeComponent } from '../app-home/app-home.component';

// Decides what "/" renders: the marketing site in a browser, the app-style
// welcome screen when running as an installed app (Capacitor APK, installed
// PWA, iOS standalone).
//
// A shell rather than two routes so the URL stays "/" in both cases — that
// keeps SEO, the manifest's start_url, the service worker's cache entry and
// every existing inbound link working untouched. @defer keeps each branch in
// its own lazy chunk, so a browser never downloads the app home and an
// installed app never downloads the marketing page.
//
// Signed-in users never get here: guestGuard on the route redirects them to
// the dashboard first, synchronously and with no network call.
@Component({
  selector: 'app-home-shell',
  template: `
    @if (platform.isAppContext) {
      @defer (on immediate) {
        <app-app-home />
      }
    } @else {
      @defer (on immediate) {
        <app-landing />
      }
    }
  `,
  imports: [LandingComponent, AppHomeComponent],
})
export class HomeShellComponent {
  protected readonly platform = inject(AppPlatformService);
}
