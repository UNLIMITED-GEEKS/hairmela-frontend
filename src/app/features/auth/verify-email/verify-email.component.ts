import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { ToastService } from '../../../core/toast/toast.service';
import { RoutePath, RouteQueryParam } from '../../../core/routing/route-paths';

type VerifyState = 'verifying' | 'success' | 'failed' | 'no-token';

@Component({
  selector: 'app-verify-email',
  imports: [RouterLink],
  templateUrl: './verify-email.component.html',
})
export class VerifyEmailComponent implements OnInit {
  private readonly _auth = inject(AuthService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _toast = inject(ToastService);

  protected readonly state = signal<VerifyState>('verifying');
  protected readonly resending = signal(false);
  protected readonly resent = signal(false);

  // Resend is JWT-gated — only offer it when the user is logged in. A logged-out
  // user who hit an expired link must sign in first.
  protected readonly isLoggedIn = this._currentUser.user;

  protected readonly dashboardLink = RoutePath.dashboard();
  protected readonly loginLink = RoutePath.login();

  ngOnInit(): void {
    const token = this._route.snapshot.queryParamMap.get(RouteQueryParam.TOKEN);

    if (!token) {
      this.state.set('no-token');
      return;
    }

    this._auth.verifyEmail(token).subscribe({
      next: () => this.state.set('success'),
      error: () => this.state.set('failed'),
    });
  }

  protected resend(): void {
    if (this.resending() || this.resent()) return;
    this.resending.set(true);
    this._auth.resendVerification().subscribe({
      next: () => {
        this.resending.set(false);
        this.resent.set(true);
        this._toast.success('Verification email sent — check your inbox.');
      },
      error: () => {
        // 400 → already verified; nothing more to do.
        this.resending.set(false);
        this.resent.set(true);
      },
    });
  }
}
