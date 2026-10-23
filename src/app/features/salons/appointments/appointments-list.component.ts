import { Component, OnInit, inject, signal, computed, viewChildren, DestroyRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../../api/api-configuration';
import { AppointmentsCalendarService } from './appointments-calendar.service';
import { QueueEntry } from '../../../api/models/queue-entry';
import { QueueEntryMember } from '../../../api/models/queue-entry-member';
import { QueueMemberService } from '../../../api/models/queue-member-service';
import { RescheduleDialogComponent } from '../../visit/reschedule-dialog/reschedule-dialog.component';
import { canReschedule } from '../../../core/appointments/reschedule-policy';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { MiniMonthCalendarComponent } from '../../../shared/components/mini-month-calendar/mini-month-calendar.component';
import { AccordionComponent } from '../../../shared/components/accordion/accordion.component';
import { CommentsThreadComponent } from '../../comments/comments-thread/comments-thread.component';
import { RouteParam } from '../../../core/routing/route-paths';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { canChatFromHistory, queueEntryHistoryDate } from './queue-entry-history.util';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonRole } from '../../../core/salon-context/membership.types';
import { AddClientModalService } from '../../queue/add-client-modal/add-client-modal.service';
import { SalonServicesCache } from '../../../core/appointments/salon-services-cache.service';
import { ToastService } from '../../../core/toast/toast.service';
import { CurrencyNgnPipe } from '../../../shared/pipes/currency-ngn.pipe';
import {
  AddMemberServicesModalComponent,
  SelectableMemberService,
} from '../../../shared/components/add-member-services-modal/add-member-services-modal.component';
import { EditMemberServicePriceModalComponent } from '../../../shared/components/edit-member-service-price-modal/edit-member-service-price-modal.component';
import { queueManagementControllerAddMemberServices } from '../../../api/fn/queues/queue-management-controller-add-member-services';
import { queueManagementControllerUpdateMemberServicePrice } from '../../../api/fn/queues/queue-management-controller-update-member-service-price';
import {
  calculateTotalMemberPrice,
  getMemberServiceErrorMessage,
} from '../../../core/queue/member-services.util';

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

type EntryFilter = 'ALL' | 'APPOINTMENTS' | 'WALK_INS';

// Month-grid calendar — staffId present means one staff member's history;
// absent means the whole salon. AppointmentsCalendarService prefetches and
// caches each month; this component owns the appointment/walk-in visibility,
// per-day badges and selection.
@Component({
  selector: 'app-appointments-list',
  templateUrl: './appointments-list.component.html',
  imports: [
    SkeletonComponent,
    PageHeaderComponent,
    DatePipe,
    MiniMonthCalendarComponent,
    AccordionComponent,
    CommentsThreadComponent,
    RescheduleDialogComponent,
    CurrencyNgnPipe,
    AddMemberServicesModalComponent,
    EditMemberServicePriceModalComponent,
  ],
})
export class AppointmentsListComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _salonContext = inject(SalonContextService);
  private readonly _addClientModal = inject(AddClientModalService);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _toast = inject(ToastService);
  private readonly _servicesCache = inject(SalonServicesCache);
  protected readonly calendar = inject(AppointmentsCalendarService);

  protected readonly isStaffScoped = computed(() => !!this._staffId);
  protected readonly canCreateAppointment = computed(() => {
    const membership = this._salonContext.membership();
    return !!membership?.queueId && !!membership.staffId;
  });
  protected readonly canEditPrice = computed(() => {
    const role = this._salonContext.membership()?.role;
    return role === SalonRole.OWNER || role === SalonRole.ADMIN;
  });

  protected readonly currencyCode = computed(() => this._salonContext.currency() ?? null);
  protected readonly availableServices = signal<SelectableMemberService[]>([]);

  protected readonly addServiceModalOpen = signal(false);
  protected readonly addServiceTarget = signal<{
    entryId: string;
    queueId: string;
    memberId: string;
    memberName: string;
  } | null>(null);
  protected readonly addingServices = signal(false);

  protected readonly editPriceModalOpen = signal(false);
  protected readonly editPriceTarget = signal<{
    entryId: string;
    queueId: string;
    memberId: string;
    selectionId: string;
    serviceName: string;
    currentPrice: string;
  } | null>(null);
  protected readonly updatingPrice = signal(false);

  protected readonly calculateTotalMemberPrice = calculateTotalMemberPrice;

  // Only one entry's Notes accordion open at a time — same pattern as
  // queue-list's per-row Notes.
  protected readonly openNotesEntryId = signal<string | null>(null);
  private readonly _commentsThreads = viewChildren(CommentsThreadComponent);

  // The visible month, first-of-month at local midnight.
  protected readonly viewedMonth = signal(this._startOfMonth(new Date()));
  protected readonly selectedDate = signal<string | null>(null);
  protected readonly entryFilter = signal<EntryFilter>('ALL');

  /** The appointment being rescheduled, or null when the dialog is closed. */
  protected readonly rescheduleEntry = signal<QueueEntry | null>(null);

  protected showChat(entry: QueueEntry): boolean {
    return canChatFromHistory(entry, toIsoDate(new Date()));
  }

  protected canReschedule(entry: QueueEntry): boolean {
    return canReschedule(entry);
  }

  protected openReschedule(entry: QueueEntry): void {
    this.rescheduleEntry.set(entry);
  }

  protected onRescheduled(): void {
    // The appointment may have moved to a different DAY, so it can leave this
    // day's list entirely. refresh(), not load() — load is cache-backed and
    // would hand back the pre-move range unchanged.
    const { from, to } = this._monthRange(this.viewedMonth());
    this.calendar.refresh(this._salonId, this._staffId, from, to);
  }

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  /** Same value, exposed for the reschedule dialog's salonId input. */
  protected get salonId(): string {
    return this._salonId;
  }

  private get _staffId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.STAFF_ID) ?? '';
  }

  protected readonly badgeFor = computed(() => {
    const countByDay = this._countByDay();
    return (iso: string) => countByDay.get(iso) ?? 0;
  });

  protected readonly selectedDayEntries = computed<QueueEntry[]>(() => {
    const day = this.selectedDate();
    if (!day) return [];
    return this.visibleEntries().filter((entry) => queueEntryHistoryDate(entry) === day);
  });

  protected readonly visibleEntries = computed(() =>
    this.calendar.entries().filter((entry) => {
      if (this.entryFilter() === 'APPOINTMENTS') return entry.type === 'APPOINTMENT';
      if (this.entryFilter() === 'WALK_INS') return entry.type === 'WALK_IN';
      return true;
    }),
  );

  private readonly _countByDay = computed(() => {
    const map = new Map<string, number>();
    // Calendar dots represent all activity and do not disappear when the
    // selected day's list is filtered to one entry type.
    for (const entry of this.calendar.entries()) {
      const iso = queueEntryHistoryDate(entry);
      if (!iso) continue;
      map.set(iso, (map.get(iso) ?? 0) + 1);
    }
    return map;
  });

  ngOnInit(): void {
    // Always prefetch the current month on load — this page is highly
    // visited and should feel instant, not wait for a click before fetching.
    // Auto-select today so the entries panel below the grid is never empty
    // on arrival — same pattern as the booking modals' day auto-selection.
    this.selectedDate.set(toIsoDate(new Date()));
    this._loadMonth(this.viewedMonth());
    this._loadServices();
  }

  private _loadServices(): void {
    if (!this._salonId) return;
    this._servicesCache
      .forSalon(this._salonId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((svcs) => {
        this.availableServices.set(
          svcs.map((s) => ({
            id: s.id,
            name: s.name,
            duration: s.duration ?? 30,
            price: s.price,
          })),
        );
      });
  }

  protected openAddService(entry: QueueEntry, member: QueueEntryMember): void {
    this.addServiceTarget.set({
      entryId: entry.id,
      queueId: entry.queueId,
      memberId: member.id,
      memberName: member.memberName,
    });
    this.addServiceModalOpen.set(true);
  }

  protected closeAddService(): void {
    this.addServiceModalOpen.set(false);
    this.addServiceTarget.set(null);
  }

  protected submitAddServices(serviceIds: string[]): void {
    const target = this.addServiceTarget();
    if (!target || serviceIds.length === 0) return;
    this.addingServices.set(true);
    queueManagementControllerAddMemberServices(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
      queueId: target.queueId,
      entryId: target.entryId,
      memberId: target.memberId,
      body: { serviceIds },
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: () => {
          this.addingServices.set(false);
          this.closeAddService();
          this._toast.success(serviceIds.length === 1 ? 'Service added.' : 'Services added.');
          const { from, to } = this._monthRange(this.viewedMonth());
          this.calendar.refresh(this._salonId, this._staffId, from, to);
        },
        error: (err: unknown) => {
          this.addingServices.set(false);
          this._toast.error(getMemberServiceErrorMessage(err));
        },
      });
  }

  protected openEditPrice(
    entry: QueueEntry,
    member: QueueEntryMember,
    service: QueueMemberService,
  ): void {
    if (!this.canEditPrice()) return;
    this.editPriceTarget.set({
      entryId: entry.id,
      queueId: entry.queueId,
      memberId: member.id,
      selectionId: service.id,
      serviceName: service.service?.name ?? 'Service',
      currentPrice: service.priceSnapshot,
    });
    this.editPriceModalOpen.set(true);
  }

  protected closeEditPrice(): void {
    this.editPriceModalOpen.set(false);
    this.editPriceTarget.set(null);
  }

  protected submitEditPrice(price: string): void {
    const target = this.editPriceTarget();
    if (!target || !this.canEditPrice()) return;
    this.updatingPrice.set(true);
    queueManagementControllerUpdateMemberServicePrice(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
      queueId: target.queueId,
      entryId: target.entryId,
      memberId: target.memberId,
      selectionId: target.selectionId,
      body: { price },
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: () => {
          this.updatingPrice.set(false);
          this.closeEditPrice();
          this._toast.success('Price updated.');
          const { from, to } = this._monthRange(this.viewedMonth());
          this.calendar.refresh(this._salonId, this._staffId, from, to);
        },
        error: (err: unknown) => {
          this.updatingPrice.set(false);
          this._toast.error(getMemberServiceErrorMessage(err));
        },
      });
  }

  protected onMonthChange(month: Date): void {
    this.viewedMonth.set(month);
    // Auto-select the 1st of the newly-viewed month, same reasoning as
    // ngOnInit above — keeps the entries panel populated after navigating
    // months instead of requiring a manual day tap.
    this.selectedDate.set(toIsoDate(new Date(month.getFullYear(), month.getMonth(), 1)));
    this._loadMonth(month);
  }

  // Expand = refetch, same as queue-list's per-row Notes. Setting a new
  // entry as open implicitly collapses whichever one was open before, since
  // each row's accordion [open] is derived from equality against this signal.
  protected onEntryNotesOpenChange(entryId: string, open: boolean): void {
    if (!open) {
      if (this.openNotesEntryId() === entryId) this.openNotesEntryId.set(null);
      return;
    }
    this.openNotesEntryId.set(entryId);
    this._commentsThreads()
      .find((c) => c.entryId() === entryId)
      ?.refresh();
  }

  protected onDaySelect(iso: string): void {
    this.selectedDate.set(this.selectedDate() === iso ? null : iso);
  }

  protected selectEntryFilter(filter: EntryFilter): void {
    this.entryFilter.set(filter);
  }

  protected openCreateAppointment(): void {
    const membership = this._salonContext.membership();
    if (!membership?.queueId || !membership.staffId) return;
    this._addClientModal.openAppointment({
      salonId: membership.salonId,
      queueId: membership.queueId,
      staffId: membership.staffId,
    });
  }

  protected statusBadgeClasses(status: QueueEntry['status']): string {
    switch (status) {
      case 'SERVING':
        return 'bg-success-light text-success border-success/20';
      case 'SERVED':
        return 'bg-primary/5 text-text-primary  border-primary/20';
      case 'WAITING':
        return 'bg-secondary-light text-primary border-primary/20';
      case 'NO_SHOW':
      case 'CANCELLED':
        return 'bg-error-light text-error border-error/20';
    }
  }

  protected typeBadgeClasses(type: QueueEntry['type']): string {
    return type === 'APPOINTMENT'
      ? 'bg-blue-50 text-blue-700 border-blue-200'
      : 'bg-amber-50 text-amber-700 border-amber-200';
  }

  protected staffName(entry: QueueEntry): string {
    const staff = entry.staff;
    return staff.user ? `${staff.user.firstName} ${staff.user.lastName}` : staff.email;
  }

  private _loadMonth(month: Date): void {
    const { from, to } = this._monthRange(month);
    this.calendar.load(this._salonId, this._staffId, from, to);
  }

  private _monthRange(month: Date): { from: string; to: string } {
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    return {
      from: toIsoDate(new Date(year, monthIndex, 1)),
      to: toIsoDate(new Date(year, monthIndex + 1, 0)),
    };
  }

  private _startOfMonth(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
}
