import { Component, OnInit, inject, computed, effect, signal } from '@angular/core';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DashboardService } from './dashboard.service';
import { CurrentUserStore } from '../../core/auth/current-user.store';
import { MembershipStore } from '../../core/salon-context/membership.store';
import { StaffService } from '../staff/staff.service';
import { ActiveQueuesService } from '../queues/auth-queues/active-queues.service';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { OwnerAdminDashboardComponent } from './owner-admin/owner-admin-dashboard.component';
import { StaffDashboardComponent } from './staff/staff-dashboard.component';
import { CustomerDashboardComponent } from './customer/customer-dashboard.component';
import { PendingInvitesComponent } from './salon/pending-invites/pending-invites.component';
import { MyVisitsComponent } from './my-visits/my-visits.component';
import { QrScannerComponent } from '../../shared/components/qr-scanner/qr-scanner.component';
import { ToastService } from '../../core/toast/toast.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  imports: [
    SkeletonComponent,
    OwnerAdminDashboardComponent,
    StaffDashboardComponent,
    CustomerDashboardComponent,
    PendingInvitesComponent,
    MyVisitsComponent,
    QrScannerComponent,
  ],
})
export class DashboardComponent implements OnInit {
  protected readonly _dashboardService = inject(DashboardService);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _membershipStore = inject(MembershipStore);
  private readonly _staffService = inject(StaffService);
  private readonly _activeQueues = inject(ActiveQueuesService);
  private readonly _toast = inject(ToastService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);

  private readonly _queryParams = toSignal(this._route.queryParamMap);

  protected readonly loading = this._dashboardService.loading;
  protected readonly error = this._dashboardService.error;
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

  protected readonly myQueueId = computed(() => {
    const userId = this.user()?.id;
    if (!userId) return null;
    const me = this._staffService.staffList().find((s) => s.staff.userId === userId);
    return me?.queueId ?? null;
  });

  protected readonly activeEntries = this._activeQueues.entries;

  protected readonly showScanner = signal(false);

  protected readonly greetingSubtitle = computed(() => {
    if (this.isCustomer()) return 'Welcome to HairMela';
    if (this.isStaff()) return 'Ready for today?';
    return 'Welcome back to HairMela';
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

    // Load staff list for the active salon so we can resolve myQueueId.
    effect(() => {
      const salon = this.activeSalon();
      if (!salon) return;
      this._staffService.load(salon.salon.id);
    });
  }

  ngOnInit(): void {
    this._dashboardService.load();
    this._activeQueues.load();
  }

  protected onQrScanned(text: string): void {
    this.showScanner.set(false);
    // Extract /s/:slug from the scanned URL
    try {
      const url = new URL(text);
      const match = url.pathname.match(/^\/s\/([^/]+)/);
      if (match) {
        this._router.navigate(['/s', match[1]]);
        return;
      }
    } catch {
      /* not a URL */
    }
    this._toast.error('Not a valid HairMela QR code');
  }
}
