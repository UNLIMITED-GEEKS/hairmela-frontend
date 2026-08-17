import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners, provideAppInitializer, inject, isDevMode } from '@angular/core';
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
import { sessionInit } from './core/auth/session-init';
import { UpdateService } from './core/pwa/update.service';
import { NativeBackButtonService } from './core/native/back-button.service';
import { DeepLinkService } from './core/native/deep-link.service';
import { PersistentStore } from './core/storage/persistent-store';
import { OnScreenErrorHandler } from './core/debug/on-screen-error-handler';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // TEMPORARY DIAGNOSTIC — remove once the iOS 15 navigation bug is found.
    // Surfaces uncaught errors as on-screen toasts so they can be read on a
    // phone. Without it, every uncaught error has been silently swallowed.
    { provide: ErrorHandler, useClass: OnScreenErrorHandler },
    provideRouter(
      routes,
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
      // Scroll to top on navigation (footer/nav links), restore position on back/forward.
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
    ),
    provideHttpClient(withInterceptors([jwtInterceptor, refreshInterceptor, errorInterceptor])),
    provideApiConfiguration(environment.apiBaseUrl),
    // Starts loading Capacitor Preferences into PersistentStore's synchronous
    // cache (no-op on web). This is a HEAD START, not a guarantee: Angular runs
    // initializers in PARALLEL and only awaits them collectively, so listing
    // this first does NOT make it finish first. Anything that reads storage
    // during startup must await hydrate() itself — sessionInit does, and
    // hydrate() is idempotent so the two calls share one pass.
    provideAppInitializer(() => inject(PersistentStore).hydrate()),
    provideAppInitializer(sessionInit()),
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
  ],
};
