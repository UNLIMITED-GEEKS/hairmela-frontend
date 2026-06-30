import { Component, OnInit, inject, computed, effect } from '@angular/core';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DashboardService } from './dashboard.service';
import { CurrentUserStore } from '../../core/auth/current-user.store';
import { MembershipStore } from '../../core/salon-context/membership.store';
import { OrgContextService } from '../../core/salon-context/org-context.service';
import { UNLIMITED_SENTINEL } from '../../core/tier/tier-limits';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { OwnerAdminDashboardComponent } from './owner-admin/owner-admin-dashboard.component';
import { StaffDashboardComponent } from './staff/staff-dashboard.component';
import { CustomerDashboardComponent } from './customer/customer-dashboard.component';
import { PendingInvitesComponent } from './salon/pending-invites/pending-invites.component';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  imports: [
    SkeletonComponent,
    OwnerAdminDashboardComponent,
    StaffDashboardComponent,
    CustomerDashboardComponent,
    PendingInvitesComponent,
  ],
})
export class DashboardComponent implements OnInit {
  private readonly _dashboardService = inject(DashboardService);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _membershipStore = inject(MembershipStore);
  private readonly _orgContext = inject(OrgContextService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);

  private readonly _queryParams = toSignal(this._route.queryParamMap);

  protected readonly loading = this._dashboardService.loading;
  protected readonly user = this._currentUser.user;

  protected readonly activeSalon = computed(() => {
    const salonId = this._queryParams()?.get('salon');
    const salons = this._dashboardService.salons();
    return salonId
      ? (salons.find((s) => s.salon.id === salonId) ?? salons[0] ?? null)
      : (salons[0] ?? null);
  });

  protected readonly activeRole = computed(() => {
    const salon = this.activeSalon();
    if (!salon) return null;
    return this._membershipStore.getCached(salon.salon.id)?.role ?? salon.role;
  });

  protected readonly isOwnerOrAdmin = computed(() => {
    const role = this.activeRole();
    return role === 'OWNER' || role === 'ADMIN';
  });

  protected readonly isStaff = computed(() => this.activeRole() === 'STAFF');

  protected readonly isCustomer = computed(() => this._dashboardService.salons().length === 0);

  // Add-salon gate (handoff §3): block when the org is at its salon cap. The
  // limit is org-wide and counts salons the org owns, so we count OWNER salons
  // against salonLimit from the org's effective access. Backend still enforces
  // SALON_LIMIT_REACHED; this just shows the nudge instead of letting it 403.
  protected readonly canAddSalon = computed(() => {
    const limit = this._orgContext.access()?.salonLimit ?? UNLIMITED_SENTINEL;
    const owned = this._dashboardService.salons().filter((s) => s.role === 'OWNER').length;
    return owned < limit;
  });

  constructor() {
    effect(() => {
      if (this.loading()) return;
      const salons = this._dashboardService.salons();
      if (salons.length === 0) return;
      const current = this._queryParams()?.get('salon');
      if (!current) {
        this._router.navigate([], {
          relativeTo: this._route,
          queryParams: { salon: salons[0].salon.id },
          replaceUrl: true,
        });
      }
    });
  }

  ngOnInit(): void {
    this._dashboardService.load();
  }
}
