import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideAppInitializer, inject, isDevMode } from '@angular/core';
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

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
      // Scroll to top on navigation (footer/nav links), restore position on back/forward.
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
    ),
    provideHttpClient(withInterceptors([jwtInterceptor, refreshInterceptor, errorInterceptor])),
    provideApiConfiguration(environment.apiBaseUrl),
    provideAppInitializer(sessionInit()),
    provideCloudinaryLoader(`https://res.cloudinary.com/${environment.cloudinaryCloudName}`),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    // Wire the SW update-watcher at boot so a new deploy auto-reloads into the
    // latest version instead of needing manual refreshes. No-op in dev.
    provideAppInitializer(() => inject(UpdateService).init()),
  ],
};
