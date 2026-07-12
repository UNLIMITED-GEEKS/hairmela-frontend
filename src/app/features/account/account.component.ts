import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { CurrentUserStore } from '../../core/auth/current-user.store';
import { AuthService } from '../../core/auth/auth.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { OrgContextService } from '../../core/salon-context/org-context.service';
import { UNLIMITED_SENTINEL } from '../../core/tier/tier-limits';
import { SalonRole } from '../../core/salon-context/membership.types';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { ResetPasswordComponent } from './reset-password/reset-password.component';
import { NotificationsToggleComponent } from './notifications-toggle/notifications-toggle.component';
import { VerifyEmailBannerComponent } from '../../shared/components/verify-email-banner/verify-email-banner.component';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { RoutePath } from '../../core/routing/route-paths';

@Component({
  selector: 'app-account',
  templateUrl: './account.component.html',
  imports: [
    RouterLink,
    DatePipe,
    SkeletonComponent,
    ResetPasswordComponent,
    NotificationsToggleComponent,
    VerifyEmailBannerComponent,
    PageHeaderComponent,
  ],
})
export class AccountComponent {
  protected readonly _currentUser = inject(CurrentUserStore);
  protected readonly _auth = inject(AuthService);
  private readonly _dashboardService = inject(DashboardService);
  private readonly _orgContext = inject(OrgContextService);

  protected readonly dashboardLink = RoutePath.dashboard();
  protected readonly editProfileLink = RoutePath.editProfile();
  protected readonly newSalonLink = RoutePath.newSalon();

  protected readonly canAddSalon = computed(() => {
    const limit = this._orgContext.access()?.salonLimit ?? UNLIMITED_SENTINEL;
    const owned = this._dashboardService.salons().filter((s) => s.role === SalonRole.OWNER).length;
    return owned < limit;
  });

  protected viewPlans(): void {
    this._orgContext.goToBilling();
  }

  protected get initials(): string {
    const user = this._currentUser.user();
    if (!user) return '?';
    return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
  }
}
