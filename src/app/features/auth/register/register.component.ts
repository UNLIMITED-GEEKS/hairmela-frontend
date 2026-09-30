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
import { GuestStore } from '../../../core/guest/guest-store';
import { ErrorCodes } from '../../../core/errors/error-codes';
import { isApiError } from '../../../core/errors/api-error.types';
import { RoutePath, RouteQueryParam } from '../../../core/routing/route-paths';
import { PasswordToggleDirective } from '../../../shared/directives/password-toggle.directive';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { AuthBrandComponent } from '../../../shared/components/auth-brand/auth-brand.component';
import { scrollToFirstInvalidControl } from '../../../core/utils/scroll-to-first-invalid';
import { AppPlatformService } from '../../../core/native/app-platform.service';
import { PhoneInputComponent } from '../../../shared/components/phone-input/phone-input.component';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { GoogleAuthButtonComponent } from '../../../shared/components/google-auth-button/google-auth-button.component';
import { AppleAuthButtonComponent } from '../../../shared/components/apple-auth-button/apple-auth-button.component';
import { AppleIdentityCredential } from '../../../core/auth/apple-identity.service';

@Component({
  selector: 'app-register',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    PasswordToggleDirective,
    FieldErrorComponent,
    AuthBrandComponent,
    PhoneInputComponent,
    InlineSpinnerComponent,
    GoogleAuthButtonComponent,
    AppleAuthButtonComponent,
  ],
  templateUrl: './register.component.html',
})
export class RegisterComponent {
  protected readonly platform = inject(AppPlatformService);

  // The <form> element, so a blocked submit can scroll to the first
  // invalid field — see scrollToFirstInvalidControl.
  private readonly _formEl = viewChild<ElementRef<HTMLElement>>('formEl');
  private readonly _scrollInjector = inject(Injector);

  private readonly _auth = inject(AuthService);
  private readonly _guestStore = inject(GuestStore);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _fb = inject(FormBuilder);

  protected readonly returnUrl = this._route.snapshot.queryParamMap.get(RouteQueryParam.RETURN_URL);

  protected readonly loginLink = RoutePath.login();

  protected get loginQueryParams(): Record<string, string> {
    return this.returnUrl ? { [RouteQueryParam.RETURN_URL]: this.returnUrl } : {};
  }

  protected readonly form = this._fb.nonNullable.group({
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    phone: ['', Validators.required],
  });

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected googleSignIn(idToken: string): void {
    if (this.loading()) return;
    this.errorMessage.set(null);
    this.loading.set(true);
    const guestToken = this._guestStore.getToken() ?? undefined;
    const firstName = this.form.controls.firstName.value.trim() || undefined;
    const lastName = this.form.controls.lastName.value.trim() || undefined;
    const dto = {
      idToken,
      createOrganization: true,
      ...(guestToken ? { guestToken } : {}),
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
    };
    this._auth.googleSignIn(dto).subscribe({
      next: () => {
        this._guestStore.clear();
        void this._router.navigateByUrl(this.returnUrl ?? RoutePath.dashboard()[0]);
      },
      error: (err) => this._handleGoogleError(err),
    });
  }

  protected googleUnavailable(): void {
    this.errorMessage.set('Google sign-up could not be opened. Please try again.');
  }

  protected appleSignIn(credential: AppleIdentityCredential): void {
    if (this.loading()) return;
    this.errorMessage.set(null);
    this.loading.set(true);
    const guestToken = this._guestStore.getToken() ?? undefined;
    const firstName = this.form.controls.firstName.value.trim() || credential.firstName;
    const lastName = this.form.controls.lastName.value.trim() || credential.lastName;
    this._auth
      .appleSignIn({
        idToken: credential.idToken,
        createOrganization: true,
        ...(guestToken ? { guestToken } : {}),
        ...(firstName ? { firstName } : {}),
        ...(lastName ? { lastName } : {}),
      })
      .subscribe({
        next: () => {
          this._guestStore.clear();
          void this._router.navigateByUrl(this.returnUrl ?? RoutePath.dashboard()[0]);
        },
        error: (err) => this._handleAppleError(err),
      });
  }

  protected appleUnavailable(): void {
    this.errorMessage.set('Apple sign-up could not be opened. Please try again.');
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

    const { email, password, firstName, lastName, phone } = this.form.getRawValue();
    const guestToken = this._guestStore.getToken() ?? undefined;
    const dto = {
      email,
      password,
      firstName,
      lastName,
      phone: phone.trim(),
      ...(guestToken ? { guestToken } : {}),
    };

    this._auth.register(dto).subscribe({
      next: () => {
        this._guestStore.clear();
        const returnUrl = new URLSearchParams(window.location.search).get(
          RouteQueryParam.RETURN_URL,
        );
        this._router.navigateByUrl(returnUrl ?? RoutePath.dashboard()[0]);
      },
      error: (err) => {
        this.loading.set(false);
        const body = err?.error;
        if (isApiError(body) && body.code === ErrorCodes.EMAIL_ALREADY_REGISTERED) {
          this.errorMessage.set('An account with this email already exists.');
        } else {
          this.errorMessage.set('Something went wrong. Please try again.');
        }
      },
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
      if (body.code === ErrorCodes.GOOGLE_PROFILE_INCOMPLETE) {
        this.errorMessage.set(
          'Enter your first and last name above, then continue with Google again.',
        );
        return;
      }
      if (body.code === ErrorCodes.GOOGLE_AUTH_DISABLED) {
        this.errorMessage.set('Google sign-up is temporarily unavailable.');
        return;
      }
      if (body.code === ErrorCodes.GOOGLE_TOKEN_INVALID) {
        this.errorMessage.set('Google could not verify this sign-up. Please try again.');
        return;
      }
      if (body.code === ErrorCodes.IDENTITY_CONFLICT) {
        this.errorMessage.set('This Google identity is already connected to another account.');
        return;
      }
    }
    this.errorMessage.set('Google sign-up failed. Please try again.');
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
          'Enter your first and last name above, then continue with Apple again.',
        );
        return;
      }
      if (body.code === ErrorCodes.APPLE_AUTH_DISABLED) {
        this.errorMessage.set('Apple sign-up is temporarily unavailable.');
        return;
      }
      if (body.code === ErrorCodes.APPLE_TOKEN_INVALID) {
        this.errorMessage.set('Apple could not verify this sign-up. Please try again.');
        return;
      }
      if (body.code === ErrorCodes.IDENTITY_CONFLICT) {
        this.errorMessage.set('This Apple identity is already connected to another account.');
        return;
      }
    }
    this.errorMessage.set('Apple sign-up failed. Please try again.');
  }
}
