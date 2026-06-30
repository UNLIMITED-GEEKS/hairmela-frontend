import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { CurrentUserStore } from '../../core/auth/current-user.store';
import { AuthService } from '../../core/auth/auth.service';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { ResetPasswordComponent } from './reset-password/reset-password.component';
import { NotificationsToggleComponent } from './notifications-toggle/notifications-toggle.component';
import { VerifyEmailBannerComponent } from '../../shared/components/verify-email-banner/verify-email-banner.component';

@Component({
  selector: 'app-account',
  templateUrl: './account.component.html',
  imports: [RouterLink, DatePipe, SkeletonComponent, ResetPasswordComponent, NotificationsToggleComponent, VerifyEmailBannerComponent],
})
export class AccountComponent {
  protected readonly _currentUser = inject(CurrentUserStore);
  protected readonly _auth = inject(AuthService);

  protected get initials(): string {
    const user = this._currentUser.user();
    if (!user) return '?';
    return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
  }
}
