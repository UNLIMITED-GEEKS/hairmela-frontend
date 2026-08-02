import { Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { switchMap } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { GuestStore } from '../../../core/guest/guest-store';
import { ErrorCodes } from '../../../core/errors/error-codes';
import { isApiError } from '../../../core/errors/api-error.types';
import { RoutePath, RouteQueryParam } from '../../../core/routing/route-paths';
import { PasswordToggleDirective } from '../../../shared/directives/password-toggle.directive';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink, PasswordToggleDirective, FieldErrorComponent],
  templateUrl: './register.component.html',
})
export class RegisterComponent {
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

  protected submit(): void {
    if (this.loading()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.errorMessage.set(null);
    this.loading.set(true);

    const { email, password, firstName, lastName, phone } = this.form.getRawValue();
    const guestToken = this._guestStore.getToken() ?? undefined;
    const dto = {
      email, password, firstName, lastName,
      phone: phone.trim(),
      ...(guestToken ? { guestToken } : {}),
    };

    this._auth.register(dto).pipe(
      switchMap(() => this._auth.login({ email, password })),
    ).subscribe({
      next: () => {
        this._guestStore.clear();
        const returnUrl = new URLSearchParams(window.location.search).get(RouteQueryParam.RETURN_URL);
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
}
