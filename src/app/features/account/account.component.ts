import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CurrentUserStore } from '../../core/auth/current-user.store';
import { AuthService } from '../../core/auth/auth.service';
import { SalonContextService } from '../../core/salon-context/salon-context.service';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { CreateSalonCardComponent } from '../../shared/components/create-salon-card/create-salon-card.component';
import { RoutePath } from '../../core/routing/route-paths';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { InlineSpinnerComponent } from '../../shared/components/inline-spinner/inline-spinner.component';

@Component({
  selector: 'app-account',
  templateUrl: './account.component.html',
  imports: [
    SkeletonComponent,
    RouterLink,
    PageHeaderComponent,
    CreateSalonCardComponent,
    InlineSpinnerComponent,
  ],
})
export class AccountComponent {
  protected readonly _currentUser = inject(CurrentUserStore);
  protected readonly _auth = inject(AuthService);
  protected readonly loggingOut = this._auth.loggingOut;
  private readonly _salonContext = inject(SalonContextService);

  protected readonly dashboardLink = RoutePath.dashboard();
  protected readonly accountSettingsLink = RoutePath.accountSettings();
  protected readonly editProfileLink = RoutePath.editProfile();
  protected readonly favoritesLink = RoutePath.favorites();
  protected readonly myAppointmentsLink = computed<string[] | null>(() => {
    const m = this._salonContext.displayMembership();
    if (!m?.isStaff || !m.staffId) return null;
    return RoutePath.salonStaffAppointments(m.salonId, m.staffId);
  });

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

  protected readonly myQueueLink = computed<string[] | null>(() => {
    const m = this._salonContext.displayMembership();
    if (!m?.isStaff || !m.queueId) return null;
    return RoutePath.salonQueueConsole(m.salonId, m.queueId);
  });

  protected logout(): void {
    this._auth.logout();
  }

  protected get initials(): string {
    const user = this._currentUser.user();
    if (!user) return '?';
    return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
  }
}
