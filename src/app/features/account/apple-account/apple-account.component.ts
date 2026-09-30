import { Component, OnInit, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { AppleIdentityCredential } from '../../../core/auth/apple-identity.service';
import { ErrorCodes } from '../../../core/errors/error-codes';
import { isApiError } from '../../../core/errors/api-error.types';
import { AppleAuthButtonComponent } from '../../../shared/components/apple-auth-button/apple-auth-button.component';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';

@Component({
  selector: 'app-apple-account',
  imports: [FormsModule, AppleAuthButtonComponent, InlineSpinnerComponent],
  templateUrl: './apple-account.component.html',
})
export class AppleAccountComponent implements OnInit {
  private readonly _auth = inject(AuthService);

  readonly passwordStatus = output<boolean>();
  readonly knownHasPassword = input<boolean | null>(null);

  protected readonly loading = signal(true);
  protected readonly submitting = signal(false);
  protected readonly linked = signal(false);
  protected readonly hasPassword = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected currentPassword = '';
  protected newPassword = '';

  constructor() {
    effect(() => {
      if (this.knownHasPassword() === true) this.hasPassword.set(true);
    });
  }

  ngOnInit(): void {
    this._auth.appleLinkStatus().subscribe({
      next: (status) => {
        this.linked.set(status.linked);
        this.hasPassword.set(status.hasPassword);
        this.passwordStatus.emit(status.hasPassword);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('Apple account status could not be loaded.');
        this.loading.set(false);
      },
    });
  }

  protected submitApple(credential: AppleIdentityCredential): void {
    if (this.submitting()) return;
    if (!this.linked()) {
      this._link(credential.idToken);
      return;
    }
    if (!this.hasPassword()) this._setPassword(credential.idToken);
  }

  protected identityUnavailable(): void {
    this.errorMessage.set('Apple sign-in could not be opened. Please try again.');
  }

  private _link(idToken: string): void {
    if (!this.hasPassword() || !this.currentPassword) return;

    this._beginSubmit();
    this._auth
      .appleLink({
        idToken,
        password: this.currentPassword,
      })
      .subscribe({
        next: () => {
          this.currentPassword = '';
          this.linked.set(true);
          this.submitting.set(false);
          this.message.set('Apple is now linked to your HairMela account.');
        },
        error: (err) => this._handleError(err, 'Apple could not be linked. Please try again.'),
      });
  }

  private _setPassword(idToken: string): void {
    if (this.newPassword.length < 8) return;
    this._beginSubmit();
    this._auth.appleSetPassword({ idToken, newPassword: this.newPassword }).subscribe({
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
      this.errorMessage.set('This Apple identity cannot be connected to this account.');
      return;
    }
    if (isApiError(body) && body.code === ErrorCodes.APPLE_TOKEN_INVALID) {
      this.errorMessage.set('Apple could not verify this sign-in. Please try again.');
      return;
    }
    this.errorMessage.set(fallback);
  }
}
