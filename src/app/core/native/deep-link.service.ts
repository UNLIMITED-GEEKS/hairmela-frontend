import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, take } from 'rxjs/operators';
import { AppPlatformService } from './app-platform.service';

// Android App Links: routes an incoming https link to the matching in-app page.
//
// The manifest's intent filter is only half the job — it makes Android OPEN the
// app for a claimed URL, but Capacitor does not navigate anywhere on its own.
// Without this listener a deep link launches the app on whatever screen it
// would normally start on, silently discarding the link the user tapped.
//
// Only the path is used, never the host: the app claims several hosts (apex,
// www, dev) that all serve the same routes, so navigating by pathname keeps
// them equivalent and stops the WebView ever loading an external origin.
@Injectable({ providedIn: 'root' })
export class DeepLinkService {
  private readonly _router = inject(Router);
  private readonly _platform = inject(AppPlatformService);

  async init(): Promise<void> {
    if (!this._platform.isNative) return;

    const { App: CapacitorApp } = await import('@capacitor/app');

    // Warm start: the app is already running when a claimed link is tapped.
    // The router is live by then, so navigate immediately.
    await CapacitorApp.addListener('appUrlOpen', ({ url }) => this._navigate(url));

    // COLD START ordering, which is the subtle half.
    //
    // When the link LAUNCHES the app, appUrlOpen has already fired before this
    // listener exists — getLaunchUrl() recovers it. But this runs inside a
    // provideAppInitializer, and Angular runs initializers in PARALLEL: the
    // router is not yet initialised, and `sessionInit` is concurrently deciding
    // its own redirect. Navigating here would either no-op against a dead
    // router or race sessionInit, with whichever landed second silently
    // winning.
    //
    // So the deep link is applied only AFTER the first NavigationEnd — the
    // point where the router is live and sessionInit's redirect has settled.
    // The deep link is the user's explicit intent, so it correctly overrides
    // the default landing route.
    const launch = await CapacitorApp.getLaunchUrl();
    if (!launch?.url) return;

    const target = this._toInAppPath(launch.url);
    if (!target) return;

    this._router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        take(1),
      )
      .subscribe(() => {
        // replaceUrl: the startup route was never a place the user chose to be,
        // so back should not return to it.
        void this._router.navigateByUrl(target, { replaceUrl: true });
      });
  }

  private _navigate(url: string): void {
    const target = this._toInAppPath(url);
    if (target) void this._router.navigateByUrl(target);
  }

  /**
   * External URL → in-app path, or null when there is nothing to navigate to.
   *
   * Returns null for "/" specifically: a bare-domain link carries no
   * destination, and forcing a navigation there would override the startup
   * routing (guest → their queue, signed-in → last salon) with a worse default.
   *
   * KNOWN LIMITATION: paths the router does not match fall through to the `**`
   * route and render NotFoundComponent — so an unroutable deep link shows "not
   * found" in-app where the browser would have rendered the real page. Angular
   * has no pre-flight "would this match?" API, and navigate-then-detect is
   * worse than the problem. This only bites because the manifest claims EVERY
   * path on the claimed hosts; if marketing links opening in-app proves wrong
   * in practice, the fix is narrowing the intent filter to the routes the app
   * owns (`/s/*`, `/g/s/*`), not adding path-matching here.
   */
  private _toInAppPath(url: string): string | null {
    let path: string;
    try {
      const parsed = new URL(url);
      path = parsed.pathname + parsed.search + parsed.hash;
    } catch {
      return null;
    }

    if (!path || path === '/') return null;
    return path;
  }
}
