import { Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { switchMap } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { ErrorCodes } from '../../../core/errors/error-codes';
import { isApiError } from '../../../core/errors/api-error.types';

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register.component.html',
})
export class RegisterComponent {
  private readonly _auth = inject(AuthService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _fb = inject(FormBuilder);

  protected readonly returnUrl = this._route.snapshot.queryParamMap.get('returnUrl');

  protected readonly form = this._fb.nonNullable.group({
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected submit(): void {
    if (this.form.invalid || this.loading()) return;

    this.errorMessage.set(null);
    this.loading.set(true);

    const { email, password, firstName, lastName } = this.form.getRawValue();

    this._auth.register({ email, password, firstName, lastName }).pipe(
      switchMap(() => this._auth.login({ email, password })),
    ).subscribe({
      next: () => {
        const returnUrl = new URLSearchParams(window.location.search).get('returnUrl');
        this._router.navigateByUrl(returnUrl ?? '/dashboard');
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
