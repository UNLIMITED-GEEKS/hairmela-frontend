import { Component, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../../core/auth/auth.service';
import { PasswordToggleDirective } from '../../../shared/directives/password-toggle.directive';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { RoutePath, RouteQueryParam } from '../../../core/routing/route-paths';

// newPassword must match the backend's 8–72 char rule.
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const pw = group.get('newPassword')?.value;
  const confirm = group.get('confirm')?.value;
  return pw && confirm && pw !== confirm ? { mismatch: true } : null;
}

@Component({
  selector: 'app-reset-password-page',
  imports: [ReactiveFormsModule, RouterLink, PasswordToggleDirective, FieldErrorComponent],
  templateUrl: './reset-password.component.html',
})
export class ResetPasswordPageComponent implements OnInit {
  private readonly _auth = inject(AuthService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _fb = inject(FormBuilder);

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  // No token in the URL → the link is invalid; never call the API.
  protected readonly hasToken = signal(true);

  protected readonly forgotPasswordLink = RoutePath.forgotPassword();

  private _token = '';

  protected readonly form = this._fb.nonNullable.group({
    newPassword: ['', [Validators.required, Validators.minLength(PASSWORD_MIN), Validators.maxLength(PASSWORD_MAX)]],
    confirm: ['', Validators.required],
  }, { validators: passwordsMatch });

  constructor() {
    // Cross-field errors live on the group; mirror the mismatch onto `confirm`
    // so it renders through the same per-control error component as everything else.
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      const confirm = this.form.controls.confirm;
      if (this.form.errors?.['mismatch']) {
        confirm.setErrors({ ...confirm.errors, mismatch: true });
      } else if (confirm.errors?.['mismatch']) {
        const { mismatch, ...rest } = confirm.errors;
        confirm.setErrors(Object.keys(rest).length ? rest : null);
      }
    });
  }

  ngOnInit(): void {
    this._token = this._route.snapshot.queryParamMap.get(RouteQueryParam.TOKEN) ?? '';
    this.hasToken.set(this._token.length > 0);
  }

  protected submit(): void {
    if (this.loading() || !this.hasToken()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.errorMessage.set(null);
    this.loading.set(true);
    this._auth.resetPassword({
      token: this._token,
      newPassword: this.form.controls.newPassword.value,
    }).subscribe({
      // No tokens returned — the reset does not log the user in; send to login.
      next: () => this._router.navigate(RoutePath.login(), { queryParams: { [RouteQueryParam.RESET]: '1' } }),
      error: (err) => {
        this.loading.set(false);
        // 400 "Invalid or expired reset token" — wrong, used, or past 1-hour window.
        if (err?.status === 400) {
          this.errorMessage.set('This reset link is invalid or has expired — request a new one.');
        } else {
          this.errorMessage.set('Could not reset your password. Please try again.');
        }
      },
    });
  }
}
