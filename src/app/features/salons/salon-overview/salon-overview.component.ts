import { Component, OnInit, inject, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SalonOverviewService } from './salon-overview.service';
import { InvitesService } from '../../dashboard/invites.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonRole } from '../../../core/salon-context/membership.types';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { FrozenBannerComponent } from '../../../shared/components/frozen-banner/frozen-banner.component';
import { TierBannerComponent } from '../../../shared/components/tier-banner/tier-banner.component';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-salon-overview',
  templateUrl: './salon-overview.component.html',
  imports: [RouterLink, SkeletonComponent, FrozenBannerComponent, TierBannerComponent],
})
export class SalonOverviewComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _salonOverviewService = inject(SalonOverviewService);
  private readonly _invitesService = inject(InvitesService);

  protected readonly salonContext = inject(SalonContextService);
  protected readonly salon = this._salonOverviewService.salon;
  protected readonly myStaff = this._salonOverviewService.myStaff;
  protected readonly loading = this._salonOverviewService.loading;
  protected readonly error = this._salonOverviewService.error;
  protected readonly invites = this._invitesService.invites;

  protected readonly isOwnerOrAdmin = computed(() => {
    const role = this.myStaff()?.role;
    return role === SalonRole.OWNER || role === SalonRole.ADMIN;
  });

  protected readonly isStaff = computed(() => this.myStaff()?.role === SalonRole.STAFF);

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  ngOnInit(): void {
    const userId = this._currentUser.user()?.id ?? '';
    this._salonOverviewService.load(this._salonId, userId);
    this._invitesService.load();

    if (!this.salon() && !this.loading()) {
      this._router.navigate(RoutePath.dashboard());
    }
  }

  protected retry(): void {
    const userId = this._currentUser.user()?.id ?? '';
    this._salonOverviewService.refresh(this._salonId, userId);
  }

  protected toggleAcceptingClients(): void {
    const staffId = this.myStaff()?.id;
    if (staffId) this._salonOverviewService.toggleAcceptingClients(this._salonId, staffId);
  }

  protected acceptInvite(invite: ReturnType<typeof this.invites>[number]): void {
    this._invitesService.accept(invite);
  }

  protected declineInvite(invite: ReturnType<typeof this.invites>[number]): void {
    this._invitesService.decline(invite);
  }

  protected queueConsoleLink(salonId: string, queueId: string): string[] {
    return RoutePath.salonQueueConsole(salonId, queueId);
  }

  protected staffLink(salonId: string): string[] {
    return RoutePath.salonStaff(salonId);
  }

  protected servicesLink(salonId: string): string[] {
    return RoutePath.salonServices(salonId);
  }

  protected settingsLink(salonId: string): string[] {
    return RoutePath.salonSettings(salonId);
  }

  protected analyticsLink(salonId: string): string[] {
    return RoutePath.salonAnalytics(salonId);
  }

  protected shareLink(salonId: string): string[] {
    return RoutePath.salonShare(salonId);
  }

  protected closuresLink(salonId: string): string[] {
    return RoutePath.salonClosures(salonId);
  }
}
