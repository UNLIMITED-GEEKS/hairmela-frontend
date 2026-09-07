import { Component, inject, signal, viewChild, ElementRef, Injector, afterNextRender } from '@angular/core';
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

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    PasswordToggleDirective,
    FieldErrorComponent,
    AuthBrandComponent,
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

  protected readonly justRegistered = signal(
    this._route.snapshot.queryParamMap.get(RouteQueryParam.REGISTERED) === '1',
  );

  protected readonly justReset = signal(
    this._route.snapshot.queryParamMap.get(RouteQueryParam.RESET) === '1',
  );

  protected readonly returnUrl = this._route.snapshot.queryParamMap.get(RouteQueryParam.RETURN_URL);

  protected readonly forgotPasswordLink = RoutePath.forgotPassword();
  protected readonly registerLink = RoutePath.register();

  protected get registerQueryParams(): Record<string, string> {
    return this.returnUrl ? { [RouteQueryParam.RETURN_URL]: this.returnUrl } : {};
  }

  protected readonly form = this._fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected submit(): void {
    if (this.loading()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      // Deferred: markAllAsTouched only renders the error messages on the next
      // change detection pass, and those messages shift layout.
      afterNextRender(
        () => scrollToFirstInvalidControl(this._formEl()?.nativeElement),
        { injector: this._scrollInjector },
      );
      return;
    }

    this.errorMessage.set(null);
    this.loading.set(true);

    this._auth.login(this.form.getRawValue()).subscribe({
      next: () => {
        const returnUrl = new URLSearchParams(window.location.search).get(RouteQueryParam.RETURN_URL);
        if (returnUrl) {
          this._router.navigateByUrl(returnUrl);
          return;
        }

        // Returning user: a salon id is already persisted — land there
        // directly, no fetch. salonRoleGuard validates it downstream; a
        // stale/no-longer-valid id just bounces to /dashboard.
        const lastId = this._persistentStore.get<string>(LAST_SALON_KEY);
        if (lastId) {
          this._router.navigate(RoutePath.salon(lastId));
          return;
        }

        // Nothing persisted (first login on this browser) — fetch once,
        // then land on the first salon, or /dashboard if there are none.
        this._salonsStore.ensureLoaded().subscribe({
          next: (salons) =>
            this._router.navigate(
              salons.length > 0 ? RoutePath.salon(salons[0].salon.id) : RoutePath.dashboard(),
            ),
          error: () => this._router.navigate(RoutePath.dashboard()),
        });
      },
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
}
