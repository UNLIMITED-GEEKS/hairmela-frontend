import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { CurrentUserStore } from '../../core/auth/current-user.store';
import { AuthService } from '../../core/auth/auth.service';
import { SalonContextService } from '../../core/salon-context/salon-context.service';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { ResetPasswordComponent } from './reset-password/reset-password.component';
import { NotificationsToggleComponent } from './notifications-toggle/notifications-toggle.component';
import { QueueSoundToggleComponent } from './queue-sound-toggle/queue-sound-toggle.component';
import { VerifyEmailBannerComponent } from '../../shared/components/verify-email-banner/verify-email-banner.component';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { CreateSalonCardComponent } from '../../shared/components/create-salon-card/create-salon-card.component';
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
    QueueSoundToggleComponent,
    VerifyEmailBannerComponent,
    PageHeaderComponent,
    CreateSalonCardComponent,
  ],
})
export class AccountComponent {
  protected readonly _currentUser = inject(CurrentUserStore);
  protected readonly _auth = inject(AuthService);
  private readonly _salonContext = inject(SalonContextService);

  protected readonly dashboardLink = RoutePath.dashboard();
  protected readonly editProfileLink = RoutePath.editProfile();

  // Shortcut to the user's own staff photos, shown only when they're staff
  // somewhere (STAFF/ADMIN/OWNER all count — Membership.isStaff is true for
  // all three). displayMembership tracks the last-visited salon app-wide, so
  // for a user staff at multiple salons this points at whichever one they
  // were in most recently, not a picker across all of them.
  protected readonly myPhotosLink = computed<string[] | null>(() => {
    const m = this._salonContext.displayMembership();
    if (!m?.isStaff || !m.staffId) return null;
    return RoutePath.salonStaffMedia(m.salonId, m.staffId);
  });

  protected get initials(): string {
    const user = this._currentUser.user();
    if (!user) return '?';
    return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
  }
}
