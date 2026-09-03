import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
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

  protected readonly state = signal<VerifyState>('verifying');

  // Drives the sign-in link on the failed state: a signed-out user needs a way
  // back in, while a signed-in one already has one.
  protected readonly isLoggedIn = this._currentUser.user;

  protected readonly dashboardLink = RoutePath.dashboard();
  protected readonly loginLink = RoutePath.login();
  protected readonly homeLink = RoutePath.root();

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
}
