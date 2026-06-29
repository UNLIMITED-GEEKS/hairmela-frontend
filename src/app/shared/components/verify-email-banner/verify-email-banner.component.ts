import { Component, computed, inject, signal } from '@angular/core';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/toast/toast.service';

// Soft, dismissible nudge to verify email. Verification is NOT a gate today —
// this only encourages it. Shown when a logged-in user is unverified and hasn't
// dismissed it this session.
@Component({
  selector: 'app-verify-email-banner',
  templateUrl: './verify-email-banner.component.html',
})
export class VerifyEmailBannerComponent {
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _auth = inject(AuthService);
  private readonly _toast = inject(ToastService);

  private readonly _dismissed = signal(false);
  protected readonly resending = signal(false);

  protected readonly user = this._currentUser.user;
  protected readonly visible = computed(() => {
    const user = this._currentUser.user();
    return !!user && !user.emailVerified && !this._dismissed();
  });

  protected resend(): void {
    if (this.resending()) return;
    this.resending.set(true);
    this._auth.resendVerification().subscribe({
      next: () => {
        this.resending.set(false);
        this._toast.success('Verification email sent — check your inbox.');
      },
      error: () => {
        // 400 → already verified; nothing to send, just dismiss.
        this.resending.set(false);
        this._dismissed.set(true);
      },
    });
  }

  protected dismiss(): void {
    this._dismissed.set(true);
  }
}
