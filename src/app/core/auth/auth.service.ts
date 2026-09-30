import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, switchMap, map, firstValueFrom } from 'rxjs';
import { ApiConfiguration } from '../../api/api-configuration';
import { TokenStore } from './token.store';
import { CurrentUserStore } from './current-user.store';
import { CurrentUserService } from './current-user.service';
import { MembershipStore } from '../salon-context/membership.store';
import { QueueSocketService } from '../socket/queue-socket.service';
import { CacheRegistry } from '../caching/cache-registry/cache-registry.service';
import { GuestStore } from '../guest/guest-store';
import { ActiveEntryStore } from '../queue/active-entry.store';
import { PushService } from '../push/push.service';
import { LoginDto } from '../../api/models/login-dto';
import { RegisterDto } from '../../api/models/register-dto';
import { ForgotPasswordDto } from '../../api/models/forgot-password-dto';
import { ResetPasswordDto } from '../../api/models/reset-password-dto';
import { GoogleAuthDto } from '../../api/models/google-auth-dto';
import { GoogleLinkDto } from '../../api/models/google-link-dto';
import { GoogleSetPasswordDto } from '../../api/models/google-set-password-dto';
import { GoogleLinkStatusDto } from '../../api/models/google-link-status-dto';
import { AppleAuthDto } from '../../api/models/apple-auth-dto';
import { AppleLinkDto } from '../../api/models/apple-link-dto';
import { AppleLinkStatusDto } from '../../api/models/apple-link-status-dto';
import { AppleSetPasswordDto } from '../../api/models/apple-set-password-dto';
import { UserResponseDto } from '../../api/models/user-response-dto';
import { authControllerLogin } from '../../api/fn/auth/auth-controller-login';
import { authControllerRegister } from '../../api/fn/auth/auth-controller-register';
import { authControllerVerifyEmail } from '../../api/fn/auth/auth-controller-verify-email';
import { authControllerForgotPassword } from '../../api/fn/auth/auth-controller-forgot-password';
import { authControllerResetPassword } from '../../api/fn/auth/auth-controller-reset-password';
import { authenticatedAuthControllerResendVerification } from '../../api/fn/auth/authenticated-auth-controller-resend-verification';
import { authenticatedAuthControllerLogout } from '../../api/fn/auth/authenticated-auth-controller-logout';
import { googleAuthControllerSignIn } from '../../api/fn/auth/google-auth-controller-sign-in';
import { googleAuthControllerLink } from '../../api/fn/auth/google-auth-controller-link';
import { googleAuthControllerGetStatus } from '../../api/fn/auth/google-auth-controller-get-status';
import { googleAuthControllerSetPassword } from '../../api/fn/auth/google-auth-controller-set-password';
import { appleAuthControllerSignIn } from '../../api/fn/auth/apple-auth-controller-sign-in';
import { appleAuthControllerLink } from '../../api/fn/auth/apple-auth-controller-link';
import { appleAuthControllerGetStatus } from '../../api/fn/auth/apple-auth-controller-get-status';
import { appleAuthControllerSetPassword } from '../../api/fn/auth/apple-auth-controller-set-password';
import { RoutePath } from '../routing/route-paths';
import { PayloadEncryptionService } from '../payload-encryption/payload-encryption.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _http = inject(HttpClient);
  private readonly _router = inject(Router);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _tokenStore = inject(TokenStore);
  private readonly _currentUserStore = inject(CurrentUserStore);
  private readonly _currentUserService = inject(CurrentUserService);
  private readonly _membershipStore = inject(MembershipStore);
  private readonly _socketService = inject(QueueSocketService);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _guestStore = inject(GuestStore);
  private readonly _activeEntryStore = inject(ActiveEntryStore);
  private readonly _pushService = inject(PushService);
  private readonly _payloadEncryption = inject(PayloadEncryptionService);

  private readonly _loggingOut = signal(false);
  readonly loggingOut = this._loggingOut.asReadonly();

  login(dto: LoginDto): Observable<UserResponseDto> {
    return authControllerLogin(this._http, this._apiConfig.rootUrl, { body: dto }).pipe(
      switchMap((res) =>
        this._establishAuthenticatedSession(res.body.accessToken, res.body.refreshToken),
      ),
    );
  }

  register(dto: RegisterDto): Observable<UserResponseDto> {
    return authControllerRegister(this._http, this._apiConfig.rootUrl, { body: dto }).pipe(
      switchMap((res) =>
        this._establishAuthenticatedSession(res.body.accessToken, res.body.refreshToken),
      ),
    );
  }

  googleSignIn(dto: GoogleAuthDto): Observable<UserResponseDto> {
    return googleAuthControllerSignIn(this._http, this._apiConfig.rootUrl, { body: dto }).pipe(
      switchMap((res) =>
        this._establishAuthenticatedSession(res.body.accessToken, res.body.refreshToken),
      ),
    );
  }

  googleLink(dto: GoogleLinkDto): Observable<void> {
    return googleAuthControllerLink(this._http, this._apiConfig.rootUrl, { body: dto }).pipe(
      map(() => undefined),
    );
  }

  googleLinkStatus(): Observable<GoogleLinkStatusDto> {
    return googleAuthControllerGetStatus(this._http, this._apiConfig.rootUrl).pipe(
      map((res) => res.body),
    );
  }

  googleSetPassword(dto: GoogleSetPasswordDto): Observable<void> {
    return googleAuthControllerSetPassword(this._http, this._apiConfig.rootUrl, { body: dto }).pipe(
      map(() => undefined),
    );
  }

  appleSignIn(dto: AppleAuthDto): Observable<UserResponseDto> {
    return appleAuthControllerSignIn(this._http, this._apiConfig.rootUrl, { body: dto }).pipe(
      switchMap((res) =>
        this._establishAuthenticatedSession(res.body.accessToken, res.body.refreshToken),
      ),
    );
  }

  appleLink(dto: AppleLinkDto): Observable<void> {
    return appleAuthControllerLink(this._http, this._apiConfig.rootUrl, { body: dto }).pipe(
      map(() => undefined),
    );
  }

  appleLinkStatus(): Observable<AppleLinkStatusDto> {
    return appleAuthControllerGetStatus(this._http, this._apiConfig.rootUrl).pipe(
      map((res) => res.body),
    );
  }

  appleSetPassword(dto: AppleSetPasswordDto): Observable<void> {
    return appleAuthControllerSetPassword(this._http, this._apiConfig.rootUrl, {
      body: dto,
    }).pipe(map(() => undefined));
  }

  private _establishAuthenticatedSession(
    accessToken: string,
    refreshToken: string,
  ): Observable<UserResponseDto> {
    // New identity — drop guest state before loading account-owned data.
    this._guestStore.clear();
    this._activeEntryStore.clear();
    this._tokenStore.setTokens(accessToken, refreshToken);

    return this._fetchAndStoreUser().pipe(
      tap(() => {
        this._socketService.connect();
        // If permission already exists, re-assert this user's push subscription.
        if (this._pushService.permission === 'granted') {
          void this._pushService.enable();
        }
      }),
    );
  }

  logout(): void {
    if (this._loggingOut()) return;
    this._loggingOut.set(true);

    // Both remote cleanup calls need the still-valid Bearer token. Push must
    // go first because /auth/logout revokes that token; local teardown always
    // runs even when either best-effort request fails.
    void this._pushService
      .disable()
      .then(async () => {
        const refreshToken = this._tokenStore.getRefreshToken();
        if (!refreshToken || !this._tokenStore.getAccessToken()) return;

        try {
          await firstValueFrom(
            authenticatedAuthControllerLogout(this._http, this._apiConfig.rootUrl, {
              body: { refreshToken },
            }),
          );
        } catch {
          // Logging out locally must never be blocked by an offline or already
          // expired server session.
        }
      })
      .finally(() => {
        this._teardownSession();
        this._loggingOut.set(false);
      });
  }

  private _teardownSession(): void {
    this._socketService.disconnect();
    this._payloadEncryption.clear();
    this._tokenStore.clearTokens();
    this._currentUserStore.clear();
    this._membershipStore.invalidateAll();
    this._cacheRegistry.clearAll();
    this._activeEntryStore.clear();
    this._router.navigate(RoutePath.login());
  }

  verifyEmail(token: string): Observable<void> {
    return authControllerVerifyEmail(this._http, this._apiConfig.rootUrl, {
      body: { token },
    }).pipe(
      switchMap(() => this._fetchAndStoreUser()),
      map(() => undefined),
    );
  }

  resendVerification(): Observable<void> {
    return authenticatedAuthControllerResendVerification(this._http, this._apiConfig.rootUrl).pipe(
      map(() => undefined),
    );
  }

  // Requests a reset code be emailed. The caller must NOT reveal whether the
  // email exists — always show a neutral message regardless of outcome.
  forgotPassword(body: ForgotPasswordDto): Observable<void> {
    return authControllerForgotPassword(this._http, this._apiConfig.rootUrl, { body }).pipe(
      map(() => undefined),
    );
  }

  // Completes the reset using the emailed code (token) + new password.
  resetPassword(body: ResetPasswordDto): Observable<void> {
    return authControllerResetPassword(this._http, this._apiConfig.rootUrl, { body }).pipe(
      map(() => undefined),
    );
  }

  private _fetchAndStoreUser(): Observable<UserResponseDto> {
    return this._currentUserService.refresh();
  }
}
