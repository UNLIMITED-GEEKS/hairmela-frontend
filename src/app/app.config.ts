import {
  ApplicationConfig,
  ErrorHandler,
  provideBrowserGlobalErrorListeners,
  provideAppInitializer,
  inject,
  isDevMode,
} from '@angular/core';
import { provideRouter, withRouterConfig, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideCloudinaryLoader } from '@angular/common';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { provideApiConfiguration } from './api/api-configuration';
import { environment } from '../environments/environment';
import { jwtInterceptor } from './core/interceptors/jwt.interceptor';
import { refreshInterceptor } from './core/interceptors/refresh.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { payloadEncryptionInterceptor } from './core/interceptors/payload-encryption.interceptor';
import { sessionInit } from './core/auth/session-init';
import { SplashService } from './core/splash/splash.service';
import { UpdateService } from './core/pwa/update.service';
import { NativeBackButtonService } from './core/native/back-button.service';
import { DeepLinkService } from './core/native/deep-link.service';
import { AppResumeService } from './core/native/app-resume.service';
import { AppUpdateService } from './core/native/app-update.service';
import { PersistentStore } from './core/storage/persistent-store';
import { OnScreenErrorHandler } from './core/debug/on-screen-error-handler';
import { ThemeService } from './core/theme/theme.service';
import { MetaPixelService } from './core/analytics/meta-pixel.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Global error handler — the app had none, so uncaught errors were
    // silently swallowed. See the FIXME in that file: it currently only logs,
    // and there is a known unidentified error firing during login.
    { provide: ErrorHandler, useClass: OnScreenErrorHandler },
    provideRouter(
      routes,
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
      // Angular restores the public shell's window scroll. Auth/guest shells
      // use RouteScrollRestorationService because their inner <main> scrolls.
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
    ),
    provideHttpClient(
      withInterceptors([
        jwtInterceptor,
        refreshInterceptor,
        errorInterceptor,
        // Must remain innermost: it decrypts both successful and error
        // responses before auth/error interceptors inspect their bodies.
        payloadEncryptionInterceptor,
      ]),
    ),
    provideApiConfiguration(environment.apiBaseUrl),
    // Starts loading Capacitor Preferences into PersistentStore's synchronous
    // cache (no-op on web). This is a HEAD START, not a guarantee: Angular runs
    // initializers in PARALLEL and only awaits them collectively, so listing
    // this first does NOT make it finish first. Anything that reads storage
    // during startup must await hydrate() itself — sessionInit does, and
    // hydrate() is idempotent so the two calls share one pass.
    provideAppInitializer(() => inject(PersistentStore).hydrate()),
    provideAppInitializer(sessionInit()),
    // Awaits PersistentStore hydration on native and applies the theme before
    // first paint, preventing any light-to-dark flash or theme reversion.
    provideAppInitializer(() => inject(ThemeService).init()),
    // Meta Pixel is web-only and remains completely unloaded until the visitor
    // has accepted optional cookies. The service also tracks SPA navigations.
    provideAppInitializer(() => inject(MetaPixelService).initIfConsented()),
    // Start the splash's exit clock once Angular is up. In an installed app it
    // has been on screen since the first frame; on the web this is a no-op
    // unless SplashService was opted in for the dashboard redirect.
    //
    // NOT awaited and returns nothing: an initializer that returned the timer
    // would hold up bootstrap for a full second, which is the opposite of the
    // point — the app must load underneath the splash, not behind it.
    provideAppInitializer(() => {
      inject(SplashService).dismiss();
    }),
    provideCloudinaryLoader(`https://res.cloudinary.com/${environment.cloudinaryCloudName}`),
    provideServiceWorker('ngsw-worker.js', {
      // environment.serviceWorker is false only in the Capacitor native build,
      // where ngsw-worker.js is never emitted — without this the optimized
      // native bundle (isDevMode() === false) would try to register a file that
      // does not exist. Web builds set it true, so this stays `!isDevMode()`
      // for them, unchanged.
      enabled: environment.serviceWorker && !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    // Wire the SW update-watcher at boot so a new deploy auto-reloads into the
    // latest version instead of needing manual refreshes. No-op in dev.
    provideAppInitializer(() => inject(UpdateService).init()),
    // Android hardware back button → in-app navigation. No-op on web.
    provideAppInitializer(() => inject(NativeBackButtonService).init()),
    // Android App Links → route the tapped URL to its in-app page. No-op on web.
    provideAppInitializer(() => inject(DeepLinkService).init()),
    // "App came back to the foreground" signal, for state left in flight by
    // work that happened outside the app. No-op on web.
    provideAppInitializer(() => inject(AppResumeService).init()),
    // Play in-app updates: blocks on a high-priority release. No-op on web.
    provideAppInitializer(() => inject(AppUpdateService).init()),
  ],
};
