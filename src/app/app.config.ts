import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideAppInitializer, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
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

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([jwtInterceptor, refreshInterceptor, errorInterceptor])),
    provideApiConfiguration(environment.apiBaseUrl),
    provideAppInitializer(sessionInit()),
    provideCloudinaryLoader(`https://res.cloudinary.com/${environment.cloudinaryCloudName}`),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
