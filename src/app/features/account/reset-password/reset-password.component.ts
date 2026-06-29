import { Component, inject, signal } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';

@Component({
  selector: 'app-reset-password',
  templateUrl: './reset-password.component.html',
})
export class ResetPasswordComponent {
  private readonly _auth = inject(AuthService);
  private readonly _currentUser = inject(CurrentUserStore);

  protected readonly loading = signal(false);
  protected readonly sent = signal(false);

  // Sends a reset link to the signed-in user's own email. The reset itself is
  // completed via that emailed link on /auth/reset-password — link-based, no code.
  protected sendLink(): void {
    const email = this._currentUser.user()?.email;
    if (!email || this.loading() || this.sent()) return;
    this.loading.set(true);
    this._auth.forgotPassword({ email }).subscribe({
      next: () => { this.loading.set(false); this.sent.set(true); },
      error: () => { this.loading.set(false); this.sent.set(true); },
    });
  }
}
