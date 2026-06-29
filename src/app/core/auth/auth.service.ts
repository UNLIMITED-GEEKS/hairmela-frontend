import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, switchMap, map } from 'rxjs';
import { ApiConfiguration } from '../../api/api-configuration';
import { TokenStore } from './token.store';
import { CurrentUserStore } from './current-user.store';
import { MembershipStore } from '../salon-context/membership.store';
import { QueueSocketService } from '../socket/queue-socket.service';
import { CacheRegistry } from '../cache-registry.service';
import { GuestStore } from '../guest/guest-store';
import { ActiveEntryStore } from '../queue/active-entry.store';
import { LoginDto } from '../../api/models/login-dto';
import { RegisterDto } from '../../api/models/register-dto';
import { ForgotPasswordDto } from '../../api/models/forgot-password-dto';
import { ResetPasswordDto } from '../../api/models/reset-password-dto';
import { UserResponseDto } from '../../api/models/user-response-dto';
import { authControllerLogin } from '../../api/fn/auth/auth-controller-login';
import { authControllerRegister } from '../../api/fn/auth/auth-controller-register';
import { authControllerVerifyEmail } from '../../api/fn/auth/auth-controller-verify-email';
import { authControllerForgotPassword } from '../../api/fn/auth/auth-controller-forgot-password';
import { authControllerResetPassword } from '../../api/fn/auth/auth-controller-reset-password';
import { authenticatedAuthControllerGetMe } from '../../api/fn/auth/authenticated-auth-controller-get-me';
import { authenticatedAuthControllerResendVerification } from '../../api/fn/auth/authenticated-auth-controller-resend-verification';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _http = inject(HttpClient);
  private readonly _router = inject(Router);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _tokenStore = inject(TokenStore);
  private readonly _currentUserStore = inject(CurrentUserStore);
  private readonly _membershipStore = inject(MembershipStore);
  private readonly _socketService = inject(QueueSocketService);
  private readonly _cacheRegistry = inject(CacheRegistry);
  private readonly _guestStore = inject(GuestStore);
  private readonly _activeEntryStore = inject(ActiveEntryStore);

  login(dto: LoginDto): Observable<UserResponseDto> {
    return authControllerLogin(this._http, this._apiConfig.rootUrl, { body: dto }).pipe(
      tap((res) => {
        // New identity — drop the guest token and any prior entries so the
        // signed-in user never inherits a guest's (or stale) queue list.
        this._guestStore.clear();
        this._activeEntryStore.clear();
        this._tokenStore.setTokens(res.body.accessToken, res.body.refreshToken);
      }),
      switchMap(() => this._fetchAndStoreUser()),
      tap(() => this._socketService.connect()),
    );
  }

  register(dto: RegisterDto): Observable<void> {
    return authControllerRegister(this._http, this._apiConfig.rootUrl, { body: dto }).pipe(
      map(() => {
        this._guestStore.clear();
        this._activeEntryStore.clear();
      }),
    );
  }

  logout(): void {
    this._socketService.disconnect();
    this._tokenStore.clearTokens();
    this._currentUserStore.clear();
    this._membershipStore.invalidateAll();
    this._cacheRegistry.clearAll();
    this._activeEntryStore.clear();
    this._router.navigate(['/login']);
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
    return authenticatedAuthControllerResendVerification(
      this._http,
      this._apiConfig.rootUrl,
    ).pipe(map(() => undefined));
  }

  // Requests a reset code be emailed. The caller must NOT reveal whether the
  // email exists — always show a neutral message regardless of outcome.
  forgotPassword(body: ForgotPasswordDto): Observable<void> {
    return authControllerForgotPassword(this._http, this._apiConfig.rootUrl, { body })
      .pipe(map(() => undefined));
  }

  // Completes the reset using the emailed code (token) + new password.
  resetPassword(body: ResetPasswordDto): Observable<void> {
    return authControllerResetPassword(this._http, this._apiConfig.rootUrl, { body })
      .pipe(map(() => undefined));
  }

  private _fetchAndStoreUser(): Observable<UserResponseDto> {
    return authenticatedAuthControllerGetMe(this._http, this._apiConfig.rootUrl).pipe(
      tap((res) => this._currentUserStore.set(res.body)),
      map((res) => res.body),
    );
  }
}
