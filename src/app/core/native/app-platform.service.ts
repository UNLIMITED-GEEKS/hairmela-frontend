import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { RoutePath } from '../routing/route-paths';

/** Which shell the app is running inside. */
export type AppShell = 'android' | 'web';

/**
 * Single answer to "am I running in the Android app or on the web?".
 *
 * Inject this rather than reading `environment.native` directly, so call sites
 * express intent ("this is native-only") instead of depending on how the build
 * happens to be configured.
 *
 * NOT the same question as InstallPromptService's `Platform`
 * ('android' | 'ios' | 'desktop'). That one sniffs the user agent to decide
 * which PWA *install instructions* to show a web visitor — a phone browsing
 * the website is `'android'` there but `'web'` here. This service answers
 * which *shell* is executing: the packaged APK, or a browser.
 *
 * WHY A BUILD-TIME CONSTANT, NOT `Capacitor.isNativePlatform()`:
 * `environment.native` is replaced at build time, so `if (!platform.isNative)`
 * branches are statically dead in a web build and the bundler drops everything
 * behind them — including any `import('@capacitor/...')` inside. A runtime
 * check cannot do that: answering it requires loading the very Capacitor code
 * we are trying to keep out of the web bundle. This was measured, not assumed
 * — an early version of the back-button service used the runtime check and put
 * ~8.6 kB of @capacitor/core into the web initial bundle.
 *
 * Consequence worth knowing: this is fixed per build, so it cannot be flipped
 * at runtime or faked in a browser to test native paths. Native behaviour has
 * to be verified on a device (or emulator), which is where it has to work
 * anyway.
 */
@Injectable({ providedIn: 'root' })
export class AppPlatformService {
  /** True only in the Capacitor Android build. */
  readonly isNative = environment.native;

  /** True in every browser build (dev server, Vercel production). */
  readonly isWeb = !environment.native;

  readonly shell: AppShell = environment.native ? 'android' : 'web';

  /**
   * Native OS, for APIs that need to name it (e.g. the push subscribe DTO's
   * `platform` field). Derived from the user agent rather than hardcoded, so
   * an iOS build reports 'ios' without hunting down scattered literals.
   * Meaningless when !isNative — callers should be inside a native branch.
   */
  readonly nativePlatform: 'android' | 'ios' = /iphone|ipad|ipod/i.test(navigator.userAgent)
    ? 'ios'
    : 'android';

  /**
   * Running as an installed app rather than in browser chrome — the Capacitor
   * APK, an installed PWA, or iOS Safari added to the home screen.
   *
   * Deliberately NOT InstallPromptService.installed(): that falls back to a
   * stored hm_pwa_installed flag, so someone who once installed the PWA reads
   * as installed even when later visiting in a normal browser tab. Only the
   * two live display checks answer "am I in app chrome right now".
   *
   * Evaluated once — display mode does not change mid-session.
   */
  readonly isAppContext = environment.native || AppPlatformService._detectStandalone();

  // Guarded because matchMedia does not exist in jsdom: this runs as a field
  // initializer, so an unguarded call threw the moment ANY test injected a
  // service that depends on this one.
  private static _detectStandalone(): boolean {
    const standaloneDisplay =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches;
    return standaloneDisplay || (navigator as { standalone?: boolean }).standalone === true;
  }

  /**
   * Where the brand logo in the nav should point. In an installed app "/" is
   * the signed-out welcome screen, so the logo goes to the dashboard instead —
   * tapping it mid-session should not look like being logged out. On web it
   * stays "/", the marketing home.
   */
  readonly homeLink: string[] = this.isAppContext ? RoutePath.dashboard() : RoutePath.root();

  constructor() {
    // Marks <html> so stylesheets can target the native shell (e.g. suppressing
    // the Android WebView's overscroll stretch, which fights the custom
    // pull-to-refresh). Set once here rather than from each consumer, so there
    // is a single place that decides what "native" looks like to CSS.
    if (this.isNative) {
      document.documentElement.classList.add('capacitor-native');
    }
  }
}
