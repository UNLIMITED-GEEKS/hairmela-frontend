import { HttpInterceptorFn, HttpErrorResponse, HttpRequest, HttpHandlerFn, HttpEvent } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, throwError, BehaviorSubject, filter, take, switchMap, catchError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { TokenStore } from '../auth/token.store';
import { CurrentUserStore } from '../auth/current-user.store';
import { ErrorCodes } from '../errors/error-codes';
import { isApiError } from '../errors/api-error.types';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { CacheRegistry } from '../caching/cache-registry/cache-registry.service';
import { RoutePath } from '../routing/route-paths';

let isRefreshing = false;
const refreshDone$ = new BehaviorSubject<string | null>(null);

// Router navigation, NOT window.location.href. A hard reload restarts the app
// — re-running sessionInit and every boot request — so a logout fired during
// session restore reloads straight back into the same failure: a loop rather
// than one redirect. Navigating leaves the already-restored state intact.
//
// Deliberately does not inject AuthService (which owns the full teardown):
// that service injects HttpClient, and this interceptor is part of HttpClient's
// own pipeline, so depending on it here risks circular DI in the auth path.
// The stores below are the ones that must not survive a rejected token.
function doLogout(
  tokenStore: TokenStore,
  currentUserStore: CurrentUserStore,
  router: Router,
  cacheRegistry: CacheRegistry,
  reason: string,
): void {
  tokenStore.clearTokens();
  currentUserStore.clear();
  cacheRegistry.clearAll();
  void router.navigate(RoutePath.login());
}

function refreshAndRetry(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  http: HttpClient,
  tokenStore: TokenStore,
  currentUserStore: CurrentUserStore,
  router: Router,
  cacheRegistry: CacheRegistry,
): Observable<HttpEvent<unknown>> {
  if (isRefreshing) {
    return refreshDone$.pipe(
      filter((token): token is string => token !== null),
      take(1),
      switchMap((token) =>
        next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }))
      ),
    );
  }

  isRefreshing = true;
  refreshDone$.next(null);

  const refreshToken = tokenStore.getRefreshToken();
  if (!refreshToken) {
    isRefreshing = false;
    doLogout(tokenStore, currentUserStore, router, cacheRegistry, 'no refresh token in storage');
    return throwError(() => new Error('No refresh token'));
  }

  // NOTE the /v1 prefix — the backend sets a global prefix (main.ts's
  // setGlobalPrefix('v1')), so the un-prefixed path 404s. It was missing here
  // while session-init.ts had it right, which meant every retry through this
  // path failed and fell straight into doLogout.
  return http.post<{ accessToken: string; refreshToken: string }>(
    `${environment.apiBaseUrl}/v1/auth/refresh`,
    { refreshToken },
  ).pipe(
    switchMap((tokens) => {
      isRefreshing = false;
      tokenStore.setTokens(tokens.accessToken, tokens.refreshToken);
      refreshDone$.next(tokens.accessToken);
      return next(req.clone({ setHeaders: { Authorization: `Bearer ${tokens.accessToken}` } }));
    }),
    catchError((err) => {
      isRefreshing = false;
      doLogout(
        tokenStore,
        currentUserStore,
        router,
        cacheRegistry,
        `refresh POST failed status=${(err as { status?: number })?.status}`,
      );
      return throwError(() => err);
    }),
  );
}

export const refreshInterceptor: HttpInterceptorFn = (req, next) => {
  const tokenStore = inject(TokenStore);
  const currentUserStore = inject(CurrentUserStore);
  const http = inject(HttpClient);
  const router = inject(Router);
  const cacheRegistry = inject(CacheRegistry);

  // Never intercept the refresh call itself
  if (req.url.includes('/auth/refresh')) {
    return next(req);
  }

  return next(req).pipe(
    catchError((err) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401) {
        return throwError(() => err);
      }

      const body = err.error;
      const code = isApiError(body) ? body.code : null;

      // No header was sent. Almost always a request that raced session
      // restore — the access token lives in memory only, so there's a window
      // on every page load where it's still null. Recoverable: if a refresh
      // token is on hand, mint a new access token and retry.
      //
      // This was the cause of a hard-reload login loop: the backend used to
      // report a missing header as TOKEN_INVALID, so the branch below logged
      // the user out mid-restore, which reloaded the page, which lost the
      // race again.
      if (code === ErrorCodes.TOKEN_MISSING) {
        if (tokenStore.getRefreshToken()) {
          return refreshAndRetry(req, next, http, tokenStore, currentUserStore, router, cacheRegistry);
        }
        // Genuinely no session — let it surface; guards handle routing.
        return throwError(() => err);
      }

      // A token WAS sent and the server rejected it. Not recoverable by
      // retrying with the same credentials.
      if (code === ErrorCodes.TOKEN_INVALID) {
        doLogout(tokenStore, currentUserStore, router, cacheRegistry, `TOKEN_INVALID on ${req.url}`);
        return throwError(() => err);
      }

      if (code === ErrorCodes.TOKEN_EXPIRED) {
        return refreshAndRetry(req, next, http, tokenStore, currentUserStore, router, cacheRegistry);
      }

      return throwError(() => err);
    }),
  );
};
