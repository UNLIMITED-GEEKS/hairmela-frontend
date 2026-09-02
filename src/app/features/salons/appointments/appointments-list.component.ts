import { Component, OnInit, inject, signal, computed, viewChildren } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { AppointmentsCalendarService } from './appointments-calendar.service';
import { QueueEntry } from '../../../api/models/queue-entry';
import { RescheduleDialogComponent } from '../../visit/reschedule-dialog/reschedule-dialog.component';
import { canReschedule, hasChatCounterparty } from '../../../core/appointments/reschedule-policy';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { MiniMonthCalendarComponent } from '../../../shared/components/mini-month-calendar/mini-month-calendar.component';
import { AccordionComponent } from '../../../shared/components/accordion/accordion.component';
import { CommentsThreadComponent } from '../../comments/comments-thread/comments-thread.component';
import { RouteParam } from '../../../core/routing/route-paths';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Month-grid calendar — one component, two modes: staffId present in the
// route -> one staff's appointments; absent -> whole-salon. Both hit the
// same date-ranged { data: QueueEntry[] } shape from
// AppointmentsCalendarService, which prefetches + caches by month so
// re-visiting a month already viewed this session is instant. Month-grid
// rendering itself is MiniMonthCalendarComponent (shared with the booking
// modals' date picker) — this component only owns the per-day appointment
// count (as the grid's badge) and the fetch-by-month logic.
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
  ],
})
export class AppointmentsListComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  protected readonly calendar = inject(AppointmentsCalendarService);

  protected readonly isStaffScoped = computed(() => !!this._staffId);

  // Only one entry's Notes accordion open at a time — same pattern as
  // queue-list's per-row Notes.
  protected readonly openNotesEntryId = signal<string | null>(null);
  private readonly _commentsThreads = viewChildren(CommentsThreadComponent);

  // The visible month, first-of-month at local midnight.
  protected readonly viewedMonth = signal(this._startOfMonth(new Date()));
  protected readonly selectedDate = signal<string | null>(null);

  /** The appointment being rescheduled, or null when the dialog is closed. */
  protected readonly rescheduleEntry = signal<QueueEntry | null>(null);

  // Staff and admins reach this same list from two routes; both act with staff
  // authority, so both use the staff endpoint (any appointment in the salon).
  /** Staff-added entries have nobody to chat with — see hasChatCounterparty. */
  protected showChat(entry: QueueEntry): boolean {
    return hasChatCounterparty(entry);
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
    return this.calendar.entries().filter((e) => this._localIso(e) === day);
  });

  private readonly _countByDay = computed(() => {
    const map = new Map<string, number>();
    for (const entry of this.calendar.entries()) {
      const iso = this._localIso(entry);
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
    this._commentsThreads().find((c) => c.entryId() === entryId)?.refresh();
  }

  protected onDaySelect(iso: string): void {
    this.selectedDate.set(this.selectedDate() === iso ? null : iso);
  }

  protected statusBadgeClasses(status: QueueEntry['status']): string {
    switch (status) {
      case 'SERVING':
        return 'bg-success-light text-success border-success/20';
      case 'SERVED':
        return 'bg-primary-light text-primary border-primary/20';
      case 'WAITING':
        return 'bg-secondary-light text-primary border-primary/20';
      case 'NO_SHOW':
      case 'CANCELLED':
        return 'bg-error-light text-error border-error/20';
    }
  }

  protected staffName(entry: QueueEntry): string {
    const staff = entry.staff;
    return staff.user ? `${staff.user.firstName} ${staff.user.lastName}` : staff.email;
  }

  // scheduledAt is a UTC ISO timestamp; the grid buckets by the salon's
  // local calendar day, which the backend's date-range query already scoped
  // the fetch to — so grouping by the UTC date's calendar portion is safe
  // here (the response only ever contains days within the requested
  // salon-local range in the first place).
  private _localIso(entry: QueueEntry): string | null {
    return entry.scheduledAt ? entry.scheduledAt.slice(0, 10) : null;
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
