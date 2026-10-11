import { Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiConfiguration } from '../../../api/api-configuration';
import { QueueEntry } from '../../../api/models/queue-entry';
import { QueueSummaryDto } from '../../../api/models/queue-summary-dto';
import { TimelineEntryDto } from '../../../api/models/timeline-entry-dto';
import { queueManagementControllerGetStaffTimeline } from '../../../api/fn/queues/queue-management-controller-get-staff-timeline';
import { publicQueueControllerGetQueue } from '../../../api/fn/queues/public-queue-controller-get-queue';
import { staffAppointmentsControllerGetStaffAppointments } from '../../../api/fn/queues/staff-appointments-controller-get-staff-appointments';
import { QueueSocketService } from '../../../core/socket/queue-socket.service';
import { SalonOverviewService } from './salon-overview.service';
import { InvitesService } from '../../dashboard/invites.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { NoPhotoBannerComponent } from '../../../shared/components/no-photo-banner/no-photo-banner.component';
import { PushPromptComponent } from '../../../shared/components/push-prompt/push-prompt.component';
import { SalonRole } from '../../../core/salon-context/membership.types';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { FrozenBannerComponent } from '../../../shared/components/frozen-banner/frozen-banner.component';
import { TierBannerComponent } from '../../../shared/components/tier-banner/tier-banner.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { StaffAppointmentModalService } from '../../queue/staff-appointment-modal/staff-appointment-modal.service';
import { ToastService } from '../../../core/toast/toast.service';
import { RouteParam, RoutePath, RouteQueryParam } from '../../../core/routing/route-paths';
import { environment } from '../../../../environments/environment';
import { AnalyticsService } from '../analytics/analytics.service';
import { AppointmentsCalendarService } from '../appointments/appointments-calendar.service';
import { queueEntryHistoryDate } from '../appointments/queue-entry-history.util';
import { CurrencyNgnPipe } from '../../../shared/pipes/currency-ngn.pipe';
import { currencySymbol } from '../../../core/geo/currencies.data';
import { SalonMediaService } from '../salon-media/salon-media.service';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { StaffMediaService } from '../../staff/staff-media/staff-media.service';
import { MyAnalyticsService, daysThrough, salonToday } from '../analytics/my-analytics.service';

function timeOfDayGreeting(hour: number): string {
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

@Component({
  selector: 'app-salon-overview',
  templateUrl: './salon-overview.component.html',
  imports: [
    RouterLink,
    SkeletonComponent,
    FrozenBannerComponent,
    TierBannerComponent,
    IconComponent,
    NoPhotoBannerComponent,
    PushPromptComponent,
    DatePipe,
    CurrencyNgnPipe,
    MediaUrlPipe,
  ],
  providers: [MyAnalyticsService],
})
export class SalonOverviewComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _socket = inject(QueueSocketService);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _salonOverviewService = inject(SalonOverviewService);
  private readonly _invitesService = inject(InvitesService);
  private readonly _toast = inject(ToastService);
  private readonly _staffAppointmentModal = inject(StaffAppointmentModalService);
  private readonly _analytics = inject(AnalyticsService);
  private readonly _myAnalytics = inject(MyAnalyticsService);
  private readonly _appointments = inject(AppointmentsCalendarService);
  protected readonly salonMedia = inject(SalonMediaService);
  protected readonly staffMedia = inject(StaffMediaService);

  protected readonly salonContext = inject(SalonContextService);
  protected readonly salon = this._salonOverviewService.salon;
  protected readonly myStaff = this._salonOverviewService.myStaff;
  protected readonly onlyOneActiveStaff = this._salonOverviewService.onlyOneActiveStaff;
  protected readonly loading = this._salonOverviewService.loading;
  protected readonly error = this._salonOverviewService.error;
  protected readonly invites = this._invitesService.invites;
  protected readonly user = this._currentUser.user;
  protected readonly greeting = timeOfDayGreeting(new Date().getHours());
  protected readonly currencySymbol = currencySymbol;
  protected readonly myAnalytics = this._myAnalytics;
  protected readonly monthlySummary = signal<QueueSummaryDto | null>(null);
  protected readonly monthlySummaryLoading = signal(false);
  protected readonly appointmentHistory = this._appointments;
  protected readonly staffTimeline = signal<TimelineEntryDto[]>([]);
  protected readonly queueLoading = signal(false);
  protected readonly queueError = signal(false);
  protected readonly queueStatus = signal<'OPEN' | 'PAUSED' | 'CLOSED' | null>(null);
  protected readonly upcomingAppointments = signal<QueueEntry[]>([]);
  protected readonly upcomingLoading = signal(false);
  protected readonly upcomingError = signal(false);
  protected readonly activeQueueEntries = computed(() =>
    this.staffTimeline()
      .filter((entry) => !entry.isUpcoming && entry.position !== null)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
  );
  protected readonly queueList = computed(() => this.activeQueueEntries().slice(0, 4));
  protected readonly salonProfilePhoto = computed(() => {
    const salonId = this.salon()?.id;
    return salonId
      ? (this.salonMedia.media().find(
          (media) => media.entityId === salonId && media.type === 'PROFILE',
        ) ?? null)
      : null;
  });
  protected readonly staffProfilePhoto = computed(() => {
    const staffId = this.myStaff()?.id;
    return staffId
      ? (this.staffMedia.media().find(
          (media) => media.entityId === staffId && media.type === 'PROFILE',
        ) ?? null)
      : null;
  });

  protected readonly recentActivity = computed(() => {
    const salonId = this.salon()?.id;
    if (!salonId) return [];
    return this._appointments.entries()
      .filter((entry) => entry.queue.salonId === salonId)
      .slice()
      .sort((a, b) => {
        const dateOrder = (queueEntryHistoryDate(b) ?? '').localeCompare(
          queueEntryHistoryDate(a) ?? '',
        );
        if (dateOrder !== 0) return dateOrder;
        const aTime = a.type === 'APPOINTMENT' ? a.scheduledAt ?? '' : a.createdAt;
        const bTime = b.type === 'APPOINTMENT' ? b.scheduledAt ?? '' : b.createdAt;
        return bTime.localeCompare(aTime);
      })
      .slice(0, 3);
  });

  protected readonly isOwnerOrAdmin = computed(() => {
    const role = this.myStaff()?.role;
    return role === SalonRole.OWNER || role === SalonRole.ADMIN;
  });

  protected readonly isStaff = computed(() => this.myStaff()?.role === SalonRole.STAFF);
  protected readonly liveQueueId = computed(() => {
    const staff = this.myStaff();
    if (!staff) return null;
    if (staff.role === SalonRole.STAFF || staff.isAcceptingClients) return staff.queueId;
    return this._salonOverviewService.soleStaffQueueId();
  });

  protected readonly howItWorksLink = RoutePath.howItWorks();
  protected readonly notificationsLink = RoutePath.notifications();

  constructor() {
    effect((onCleanup) => {
      const salon = this.salon();
      const staff = this.myStaff();
      if (!salon || !staff) return;

      untracked(() => {
        this.salonMedia.load(salon.id);
        this.staffMedia.load(staff.id);
      });

      if (staff.role === SalonRole.OWNER || staff.role === SalonRole.ADMIN) {
        const today = salonToday(salon.timezone);
        this.monthlySummary.set(null);
        this.monthlySummaryLoading.set(true);
        const summarySubscription = this._analytics.overviewSummary(
          salon.id, `${today.slice(0, 7)}-01`, today, salon.timezone,
        ).subscribe({
          next: (summary) => {
            this.monthlySummary.set(summary);
            this.monthlySummaryLoading.set(false);
          },
          error: () => this.monthlySummaryLoading.set(false),
        });
        onCleanup(() => summarySubscription.unsubscribe());
      } else {
        const today = salonToday(salon.timezone);
        this._myAnalytics.load(salon.id, today, today, salon.timezone);
        this.upcomingAppointments.set([]);
        this.upcomingLoading.set(true);
        this.upcomingError.set(false);
        const upcomingSubscription = staffAppointmentsControllerGetStaffAppointments(this._http, this._apiConfig.rootUrl, {
          salonId: salon.id,
          staffId: staff.id,
          from: today,
          to: daysThrough(today, 30),
        }).subscribe({
          next: (response) => {
            const now = Date.now();
            this.upcomingAppointments.set((response.body.data ?? [])
              .filter((entry) => entry.status === 'WAITING' && !!entry.scheduledAt && Date.parse(entry.scheduledAt) >= now)
              .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''))
              .slice(0, 2));
            this.upcomingLoading.set(false);
          },
          error: () => {
            this.upcomingError.set(true);
            this.upcomingLoading.set(false);
          },
        });
        onCleanup(() => upcomingSubscription.unsubscribe());
      }

      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      untracked(() => this._appointments.load(
        salon.id,
        staff.role === SalonRole.STAFF ? staff.id : '',
        this._toIsoDate(from),
        this._toIsoDate(to),
      ));
    });

    effect((onCleanup) => {
      const salon = this.salon();
      const queueId = this.liveQueueId();
      if (!salon || !queueId) return;
      this.staffTimeline.set([]);
      this.queueStatus.set(null);
      this.queueLoading.set(true);
      this.queueError.set(false);
      const cachedTimeline = this._socket.lastTimeline(queueId);
      let socketReceived = false;
      this._socket.connect();
      this._socket.watchQueueAsStaff(queueId);
      const timelineSubscription = this._socket.queueTimeline$(queueId).subscribe((timeline) => {
        if (timeline !== cachedTimeline) socketReceived = true;
        this.staffTimeline.set(timeline);
        this.queueLoading.set(false);
        this.queueError.set(false);
      });
      const initialSubscription = queueManagementControllerGetStaffTimeline(
        this._http, this._apiConfig.rootUrl, { salonId: salon.id, queueId },
      ).subscribe({
        next: (response) => {
          if (!socketReceived) this.staffTimeline.set(response.body.timeline);
          this.queueLoading.set(false);
        },
        error: () => {
          if (!socketReceived) this.queueError.set(true);
          this.queueLoading.set(false);
        },
      });
      const statusSubscription = publicQueueControllerGetQueue(
        this._http, this._apiConfig.rootUrl, { queueId },
      ).subscribe({ next: (response) => this.queueStatus.set(response.body.status) });
      onCleanup(() => {
        timelineSubscription.unsubscribe();
        initialSubscription.unsubscribe();
        statusSubscription.unsubscribe();
        this._socket.unwatchQueue(queueId);
      });
    });
  }

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

  protected queueCustomersLink(salonId: string, queueId: string): string[] {
    return RoutePath.salonQueueConsoleQueue(salonId, queueId);
  }

  protected openCreateAppointment(queueId: string): void {
    const staffId = this.myStaff()?.id;
    if (!staffId) return;
    this._staffAppointmentModal.open({ salonId: this._salonId, queueId, staffId });
  }

  // The public link customers use to join THIS staff member's queue — same
  // /s/{slug}/q/{queueId} shape live-queue's own "Copy queue link" copies,
  // built with no shell prefix since it's meant to be shared with someone
  // else, who should land fresh and get routed by their own session.
  protected copyMyQueueLink(slug: string, queueId: string): void {
    const path = RoutePath.visitQueue('', slug, queueId).join('/');
    navigator.clipboard
      .writeText(`${environment.appBaseUrl}${path}`)
      .then(() => this._toast.success('Queue link copied'))
      .catch(() => this._toast.error('Could not copy link'));
  }

  protected staffLink(salonId: string): string[] {
    return RoutePath.salonStaff(salonId);
  }

  protected servicesLink(salonId: string): string[] {
    return RoutePath.salonServices(salonId);
  }

  // "My Services" on the staff-facing grid — a staff member's own assigned
  // services, not the salon-wide manage-services list servicesLink() points
  // owners/admins at.
  protected myServicesLink(salonId: string, staffId: string): string[] {
    return RoutePath.salonStaffServices(salonId, staffId);
  }

  protected settingsLink(salonId: string): string[] {
    return RoutePath.salonSettings(salonId);
  }

  protected analyticsLink(salonId: string): string[] {
    return RoutePath.salonAnalytics(salonId);
  }

  protected myAnalyticsLink(salonId: string): string[] {
    return RoutePath.salonMyAnalytics(salonId);
  }

  protected shareLink(salonId: string): string[] {
    return RoutePath.salonShare(salonId);
  }

  // Shortcut to the current user's OWN staff photos — any role (owner, admin,
  // staff) has a myStaff() record here, so this needs no role check. Without
  // it, updating your own photos meant going through Staff -> your own row ->
  // Media, even though you're looking at your own overview page already.
  protected myPhotosLink(salonId: string, staffId: string): string[] {
    return RoutePath.salonStaffMedia(salonId, staffId);
  }

  protected closuresLink(salonId: string): string[] {
    return RoutePath.salonClosures(salonId);
  }

  protected staffAppointmentsLink(salonId: string, staffId: string): string[] {
    return RoutePath.salonStaffAppointments(salonId, staffId);
  }

  protected appointmentsHistoryLink(salonId: string): string[] {
    const staff = this.myStaff();
    return staff?.role === SalonRole.STAFF
      ? this.staffAppointmentsLink(salonId, staff.id)
      : RoutePath.salonAppointments(salonId);
  }

  protected newBranchLink(): string[] {
    return RoutePath.newSalon();
  }

  protected newBranchQueryParams(salonId: string, salonName: string): Record<string, string> {
    return {
      [RouteQueryParam.PARENT_SALON_ID]: salonId,
      [RouteQueryParam.PARENT_SALON_NAME]: salonName,
    };
  }

  private _toIsoDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
