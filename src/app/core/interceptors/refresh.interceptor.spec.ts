import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { refreshInterceptor } from './refresh.interceptor';
import { TokenStore } from '../auth/token.store';
import { ErrorCodes } from '../errors/error-codes';
import { environment } from '../../../environments/environment';

// Regression cover for the local-only hard-reload login loop.
//
// The access token is memory-only, so every page load has a window where it is
// null and an in-flight request goes out with no Authorization header. The
// backend answers TOKEN_MISSING for that (it used to answer TOKEN_INVALID,
// which this interceptor treated as fatal — logging the user out mid-restore,
// reloading the page, and losing the race again).
describe('refreshInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let tokenStore: TokenStore;
  let router: Router;

  const API = environment.apiBaseUrl;
  const PROTECTED = `${API}/v1/salons/abc/me`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([refreshInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    tokenStore = TestBed.inject(TokenStore);
    router = TestBed.inject(Router);
  });

  afterEach(() => httpMock.verify());

  // Mirrors the real backend envelope — isApiError() requires statusCode,
  // message and timestamp, so a bare { code } is silently ignored.
  function errorBody(code: string) {
    return {
      statusCode: 401,
      code,
      message: 'auth error',
      details: null,
      timestamp: new Date().toISOString(),
      path: '/v1/salons/abc/me',
      requestId: 'test',
    };
  }
  const unauthorized = { status: 401, statusText: 'Unauthorized' };

  it('TOKEN_MISSING with a refresh token: refreshes and retries instead of logging out', () => {
    tokenStore.setTokens('stale-access', 'good-refresh');
    // Simulate the boot race: access token not yet set.
    tokenStore.clearTokens();
    localStorage.setItem('hm_refresh_token', 'good-refresh');

    const navigate = vi.spyOn(router, 'navigate');
    let result: unknown = null;
    http.get(PROTECTED).subscribe({ next: (r) => (result = r) });

    httpMock.expectOne(PROTECTED).flush(errorBody(ErrorCodes.TOKEN_MISSING), unauthorized);

    // It must attempt a refresh — at the /v1-prefixed path.
    const refreshReq = httpMock.expectOne(`${API}/v1/auth/refresh`);
    refreshReq.flush({ accessToken: 'fresh-access', refreshToken: 'fresh-refresh' });

    // And retry the original request with the new token.
    const retry = httpMock.expectOne(PROTECTED);
    expect(retry.request.headers.get('Authorization')).toBe('Bearer fresh-access');
    retry.flush({ ok: true });

    expect(result).toEqual({ ok: true });
    expect(navigate).not.toHaveBeenCalled(); // never logged out
  });

  it('TOKEN_MISSING with NO refresh token: surfaces the error, does not loop', () => {
    localStorage.removeItem('hm_refresh_token');
    const navigate = vi.spyOn(router, 'navigate');
    let errored = false;

    http.get(PROTECTED).subscribe({ error: () => (errored = true) });
    httpMock.expectOne(PROTECTED).flush(errorBody(ErrorCodes.TOKEN_MISSING), unauthorized);

    expect(errored).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('TOKEN_INVALID: still logs out — a real bad token is fatal', () => {
    localStorage.setItem('hm_refresh_token', 'good-refresh');
    const navigate = vi.spyOn(router, 'navigate');

    http.get(PROTECTED).subscribe({ error: () => undefined });
    httpMock.expectOne(PROTECTED).flush(errorBody(ErrorCodes.TOKEN_INVALID), unauthorized);

    expect(navigate).toHaveBeenCalled();
  });
});
