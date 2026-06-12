import { HttpInterceptorFn, HttpErrorResponse, HttpRequest, HttpHandlerFn, HttpEvent } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, throwError, BehaviorSubject, filter, take, switchMap, catchError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { TokenStore } from '../auth/token.store';
import { CurrentUserStore } from '../auth/current-user.store';
import { ErrorCodes } from '../errors/error-codes';
import { isApiError } from '../errors/api-error.types';
import { environment } from '../../../environments/environment';

let isRefreshing = false;
const refreshDone$ = new BehaviorSubject<string | null>(null);

function doLogout(tokenStore: TokenStore, currentUserStore: CurrentUserStore): void {
  tokenStore.clearTokens();
  currentUserStore.clear();
  window.location.href = '/login';
}

function refreshAndRetry(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  http: HttpClient,
  tokenStore: TokenStore,
  currentUserStore: CurrentUserStore,
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
    doLogout(tokenStore, currentUserStore);
    return throwError(() => new Error('No refresh token'));
  }

  return http.post<{ accessToken: string; refreshToken: string }>(
    `${environment.apiBaseUrl}/auth/refresh`,
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
      doLogout(tokenStore, currentUserStore);
      return throwError(() => err);
    }),
  );
}

export const refreshInterceptor: HttpInterceptorFn = (req, next) => {
  const tokenStore = inject(TokenStore);
  const currentUserStore = inject(CurrentUserStore);
  const http = inject(HttpClient);

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

      if (code === ErrorCodes.TOKEN_INVALID) {
        doLogout(tokenStore, currentUserStore);
        return throwError(() => err);
      }

      if (code === ErrorCodes.TOKEN_EXPIRED) {
        return refreshAndRetry(req, next, http, tokenStore, currentUserStore);
      }

      return throwError(() => err);
    }),
  );
};
