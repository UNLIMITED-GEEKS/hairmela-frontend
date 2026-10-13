import {
  Component,
  inject,
  signal,
  viewChild,
  ElementRef,
  Injector,
  afterNextRender,
} from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { ErrorCodes } from '../../../core/errors/error-codes';
import { isApiError } from '../../../core/errors/api-error.types';
import { PasswordToggleDirective } from '../../../shared/directives/password-toggle.directive';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { AuthBrandComponent } from '../../../shared/components/auth-brand/auth-brand.component';
import { SalonsStore } from '../../../core/salon-context/salons.store';
import { PersistentStore } from '../../../core/storage/persistent-store';
import { LAST_SALON_KEY } from '../../../core/salon-context/salon-context.service';
import { RoutePath, RouteQueryParam } from '../../../core/routing/route-paths';
import { scrollToFirstInvalidControl } from '../../../core/utils/scroll-to-first-invalid';
import { AppPlatformService } from '../../../core/native/app-platform.service';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { GoogleAuthButtonComponent } from '../../../shared/components/google-auth-button/google-auth-button.component';
import { GuestStore } from '../../../core/guest/guest-store';
import { AppleAuthButtonComponent } from '../../../shared/components/apple-auth-button/apple-auth-button.component';
import { AppleIdentityCredential } from '../../../core/auth/apple-identity.service';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    PasswordToggleDirective,
    FieldErrorComponent,
    AuthBrandComponent,
    InlineSpinnerComponent,
    GoogleAuthButtonComponent,
    AppleAuthButtonComponent,
  ],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  protected readonly platform = inject(AppPlatformService);

  // The <form> element, so a blocked submit can scroll to the first
  // invalid field — see scrollToFirstInvalidControl.
  private readonly _formEl = viewChild<ElementRef<HTMLElement>>('formEl');
  private readonly _scrollInjector = inject(Injector);

  private readonly _auth = inject(AuthService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _fb = inject(FormBuilder);
  private readonly _salonsStore = inject(SalonsStore);
  private readonly _persistentStore = inject(PersistentStore);
  private readonly _guestStore = inject(GuestStore);

  protected readonly justRegistered = signal(
    this._route.snapshot.queryParamMap.get(RouteQueryParam.REGISTERED) === '1',
  );

  protected readonly justReset = signal(
    this._route.snapshot.queryParamMap.get(RouteQueryParam.RESET) === '1',
  );

  protected readonly returnUrl = this._route.snapshot.queryParamMap.get(RouteQueryParam.RETURN_URL);

  protected readonly forgotPasswordLink = RoutePath.forgotPassword();
  protected readonly registerLink = RoutePath.register();
  protected readonly guestSearchLink = RoutePath.guestSearch();

  protected get registerQueryParams(): Record<string, string> {
    return this.returnUrl ? { [RouteQueryParam.RETURN_URL]: this.returnUrl } : {};
  }

  protected readonly form = this._fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected googleSignIn(idToken: string): void {
    if (this.loading()) return;
    this.errorMessage.set(null);
    this.loading.set(true);
    const guestToken = this._guestStore.getToken() ?? undefined;
    this._auth.googleSignIn({ idToken, ...(guestToken ? { guestToken } : {}) }).subscribe({
      next: () => this._navigateAfterSignIn(),
      error: (err) => this._handleGoogleError(err),
    });
  }

  protected googleUnavailable(): void {
    this.errorMessage.set('Google sign-in could not be opened. Please try again.');
  }

  protected appleSignIn(credential: AppleIdentityCredential): void {
    if (this.loading()) return;
    this.errorMessage.set(null);
    this.loading.set(true);
    const guestToken = this._guestStore.getToken() ?? undefined;
    this._auth
      .appleSignIn({
        idToken: credential.idToken,
        ...(guestToken ? { guestToken } : {}),
        ...(credential.firstName ? { firstName: credential.firstName } : {}),
        ...(credential.lastName ? { lastName: credential.lastName } : {}),
      })
      .subscribe({
        next: () => this._navigateAfterSignIn(),
        error: (err) => this._handleAppleError(err),
      });
  }

  protected appleUnavailable(): void {
    this.errorMessage.set('Apple sign-in could not be opened. Please try again.');
  }

  protected submit(): void {
    if (this.loading()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      // Deferred: markAllAsTouched only renders the error messages on the next
      // change detection pass, and those messages shift layout.
      afterNextRender(() => scrollToFirstInvalidControl(this._formEl()?.nativeElement), {
        injector: this._scrollInjector,
      });
      return;
    }

    this.errorMessage.set(null);
    this.loading.set(true);

    this._auth.login(this.form.getRawValue()).subscribe({
      next: () => this._navigateAfterSignIn(),
      error: (err) => {
        this.loading.set(false);
        const body = err?.error;
        if (isApiError(body) && body.code === ErrorCodes.INVALID_CREDENTIALS) {
          this.errorMessage.set('Invalid email or password.');
        } else {
          this.errorMessage.set('Something went wrong. Please try again.');
        }
      },
    });
  }

  private _navigateAfterSignIn(): void {
    const returnUrl = new URLSearchParams(window.location.search).get(RouteQueryParam.RETURN_URL);
    if (returnUrl) {
      void this._router.navigateByUrl(returnUrl);
      return;
    }

    const lastId = this._persistentStore.get<string>(LAST_SALON_KEY);
    if (lastId) {
      void this._router.navigate(RoutePath.salon(lastId));
      return;
    }

    this._salonsStore.ensureLoaded().subscribe({
      next: (salons) =>
        void this._router.navigate(
          salons.length > 0 ? RoutePath.salon(salons[0].salon.id) : RoutePath.dashboard(),
        ),
      error: () => void this._router.navigate(RoutePath.dashboard()),
    });
  }

  private _handleGoogleError(err: unknown): void {
    this.loading.set(false);
    const body = (err as { error?: unknown })?.error;
    if (isApiError(body)) {
      if (body.code === ErrorCodes.GOOGLE_LINK_REQUIRED) {
        this.errorMessage.set(
          'This email already has a HairMela account. Sign in with your password, then link Google from Account settings.',
        );
        return;
      }
      if (body.code === ErrorCodes.GOOGLE_AUTH_DISABLED) {
        this.errorMessage.set('Google sign-in is temporarily unavailable.');
        return;
      }
      if (body.code === ErrorCodes.GOOGLE_TOKEN_INVALID) {
        this.errorMessage.set('Google could not verify this sign-in. Please try again.');
        return;
      }
      if (body.code === ErrorCodes.IDENTITY_CONFLICT) {
        this.errorMessage.set('This Google identity is already connected to another account.');
        return;
      }
    }
    this.errorMessage.set('Google sign-in failed. Please try again.');
  }

  private _handleAppleError(err: unknown): void {
    this.loading.set(false);
    const body = (err as { error?: unknown })?.error;
    if (isApiError(body)) {
      if (body.code === ErrorCodes.APPLE_LINK_REQUIRED) {
        this.errorMessage.set(
          'This email already has a HairMela account. Sign in with your password, then link Apple from Account settings.',
        );
        return;
      }
      if (body.code === ErrorCodes.APPLE_PROFILE_INCOMPLETE) {
        this.errorMessage.set(
          'Apple did not share your name. Open Sign up, enter your first and last name, then continue with Apple again.',
        );
        return;
      }
      if (body.code === ErrorCodes.APPLE_AUTH_DISABLED) {
        this.errorMessage.set('Apple sign-in is temporarily unavailable.');
        return;
      }
      if (body.code === ErrorCodes.APPLE_TOKEN_INVALID) {
        this.errorMessage.set('Apple could not verify this sign-in. Please try again.');
        return;
      }
      if (body.code === ErrorCodes.IDENTITY_CONFLICT) {
        this.errorMessage.set('This Apple identity is already connected to another account.');
        return;
      }
    }
    this.errorMessage.set('Apple sign-in failed. Please try again.');
  }
}
