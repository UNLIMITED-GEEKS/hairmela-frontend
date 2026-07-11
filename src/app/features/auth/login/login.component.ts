import { Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { ErrorCodes } from '../../../core/errors/error-codes';
import { isApiError } from '../../../core/errors/api-error.types';
import { PasswordToggleDirective } from '../../../shared/directives/password-toggle.directive';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { RoutePath, RouteQueryParam } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, PasswordToggleDirective, FieldErrorComponent],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private readonly _auth = inject(AuthService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _fb = inject(FormBuilder);

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
    if (this.form.invalid || this.loading()) return;

    this.errorMessage.set(null);
    this.loading.set(true);

    this._auth.login(this.form.getRawValue()).subscribe({
      next: () => {
        const returnUrl = new URLSearchParams(window.location.search).get(RouteQueryParam.RETURN_URL);
        this._router.navigateByUrl(returnUrl ?? RoutePath.dashboard()[0]);
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
