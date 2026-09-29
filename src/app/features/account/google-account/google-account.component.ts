import { Component, OnInit, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { ErrorCodes } from '../../../core/errors/error-codes';
import { isApiError } from '../../../core/errors/api-error.types';
import { AppPlatformService } from '../../../core/native/app-platform.service';
import { GoogleAuthButtonComponent } from '../../../shared/components/google-auth-button/google-auth-button.component';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';

@Component({
  selector: 'app-google-account',
  imports: [FormsModule, GoogleAuthButtonComponent, InlineSpinnerComponent],
  templateUrl: './google-account.component.html',
})
export class GoogleAccountComponent implements OnInit {
  private readonly _auth = inject(AuthService);
  protected readonly platform = inject(AppPlatformService);

  readonly passwordStatus = output<boolean>();

  protected readonly loading = signal(true);
  protected readonly submitting = signal(false);
  protected readonly linked = signal(false);
  protected readonly hasPassword = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected currentPassword = '';
  protected newPassword = '';

  ngOnInit(): void {
    this._auth.googleLinkStatus().subscribe({
      next: (status) => {
        this.linked.set(status.linked);
        this.hasPassword.set(status.hasPassword);
        this.passwordStatus.emit(status.hasPassword);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('Google account status could not be loaded.');
        this.loading.set(false);
      },
    });
  }

  protected submitGoogleToken(idToken: string): void {
    if (this.submitting()) return;
    if (!this.linked()) {
      this._link(idToken);
      return;
    }
    if (!this.hasPassword()) this._setPassword(idToken);
  }

  private _link(idToken: string): void {
    if (!this.currentPassword) return;
    this._beginSubmit();
    this._auth.googleLink({ idToken, password: this.currentPassword }).subscribe({
      next: () => {
        this.currentPassword = '';
        this.linked.set(true);
        this.hasPassword.set(true);
        this.passwordStatus.emit(true);
        this.submitting.set(false);
        this.message.set('Google is now linked to your HairMela account.');
      },
      error: (err) => this._handleError(err, 'Google could not be linked. Please try again.'),
    });
  }

  private _setPassword(idToken: string): void {
    if (this.newPassword.length < 8) return;
    this._beginSubmit();
    this._auth.googleSetPassword({ idToken, newPassword: this.newPassword }).subscribe({
      next: () => {
        this.newPassword = '';
        this.hasPassword.set(true);
        this.passwordStatus.emit(true);
        this.submitting.set(false);
        this.message.set('Your HairMela password has been set.');
      },
      error: (err) => this._handleError(err, 'Your password could not be set. Please try again.'),
    });
  }

  protected googleUnavailable(): void {
    this.errorMessage.set('Google sign-in could not be opened. Please try again.');
  }

  private _beginSubmit(): void {
    this.submitting.set(true);
    this.errorMessage.set(null);
    this.message.set(null);
  }

  private _handleError(err: unknown, fallback: string): void {
    this.submitting.set(false);
    const body = (err as { error?: unknown })?.error;
    if (isApiError(body) && body.code === ErrorCodes.INVALID_CREDENTIALS) {
      this.errorMessage.set('Your HairMela password is incorrect.');
      return;
    }
    if (isApiError(body) && body.code === ErrorCodes.IDENTITY_CONFLICT) {
      this.errorMessage.set('This Google identity cannot be connected to this account.');
      return;
    }
    if (isApiError(body) && body.code === ErrorCodes.GOOGLE_TOKEN_INVALID) {
      this.errorMessage.set('Google could not verify this sign-in. Please try again.');
      return;
    }
    this.errorMessage.set(fallback);
  }
}
