import { Component, inject, signal, viewChild, ElementRef, Injector, afterNextRender } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { RoutePath } from '../../../core/routing/route-paths';
import { scrollToFirstInvalidControl } from '../../../core/utils/scroll-to-first-invalid';

@Component({
  selector: 'app-forgot-password',
  imports: [ReactiveFormsModule, RouterLink, FieldErrorComponent],
  templateUrl: './forgot-password.component.html',
})
export class ForgotPasswordComponent {
  // The <form> element, so a blocked submit can scroll to the first
  // invalid field — see scrollToFirstInvalidControl.
  private readonly _formEl = viewChild<ElementRef<HTMLElement>>('formEl');
  private readonly _scrollInjector = inject(Injector);

  private readonly _auth = inject(AuthService);
  private readonly _fb = inject(FormBuilder);

  protected readonly loginLink = RoutePath.login();

  protected readonly loading = signal(false);
  // True once the request has been made — we then show the neutral message
  // regardless of whether the email was registered (no account enumeration).
  protected readonly sent = signal(false);

  protected readonly form = this._fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

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
    this.loading.set(true);
    // Endpoint always returns 200; we treat success and error identically and
    // never reveal whether the account exists.
    this._auth.forgotPassword(this.form.getRawValue()).subscribe({
      next: () => { this.loading.set(false); this.sent.set(true); },
      error: () => { this.loading.set(false); this.sent.set(true); },
    });
  }
}
