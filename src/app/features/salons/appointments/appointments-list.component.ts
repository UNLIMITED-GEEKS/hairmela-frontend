import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { AppointmentsCalendarService } from './appointments-calendar.service';
import { QueueEntry } from '../../../api/models/queue-entry';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { RouteParam } from '../../../core/routing/route-paths';

interface DayCell {
  readonly date: Date;
  readonly iso: string;
  readonly inCurrentMonth: boolean;
  readonly isToday: boolean;
  readonly count: number;
}

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
// re-visiting a month already viewed this session is instant.
//
// No calendar library — native Date handles month-length/leap-year
// correctly on its own (`new Date(year, month + 1, 0).getDate()` always
// returns the real last day of the month), and a month grid + click-a-day
// list is simple enough that a dependency isn't justified here (matches
// this project's existing custom-Tailwind, no-UI-library direction).
@Component({
  selector: 'app-appointments-list',
  templateUrl: './appointments-list.component.html',
  imports: [PageHeaderComponent, SkeletonComponent, DatePipe],
})
export class AppointmentsListComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  protected readonly calendar = inject(AppointmentsCalendarService);

  protected readonly isStaffScoped = computed(() => !!this._staffId);

  // The visible month, first-of-month at local midnight.
  protected readonly viewedMonth = signal(this._startOfMonth(new Date()));
  protected readonly selectedDate = signal<string | null>(null);

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  private get _staffId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.STAFF_ID) ?? '';
  }

  protected readonly monthLabel = computed(() =>
    this.viewedMonth().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  );

  // 7-day-wide grid, leading/trailing cells from adjacent months fill out
  // the first/last week so every row has 7 days (standard calendar-grid shape).
  protected readonly weeks = computed<DayCell[][]>(() => {
    const month = this.viewedMonth();
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const firstOfMonth = new Date(year, monthIndex, 1);
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const leadingBlanks = firstOfMonth.getDay(); // 0 = Sunday
    const totalCells = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;

    const today = toIsoDate(new Date());
    const countByDay = this._countByDay();

    const cells: DayCell[] = [];
    for (let i = 0; i < totalCells; i++) {
      const dayOffset = i - leadingBlanks + 1;
      const date = new Date(year, monthIndex, dayOffset);
      const iso = toIsoDate(date);
      cells.push({
        date,
        iso,
        inCurrentMonth: date.getMonth() === monthIndex,
        isToday: iso === today,
        count: countByDay.get(iso) ?? 0,
      });
    }

    const weeks: DayCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }
    return weeks;
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
    this._loadMonth(this.viewedMonth());
  }

  protected prevMonth(): void {
    const m = this.viewedMonth();
    const prev = new Date(m.getFullYear(), m.getMonth() - 1, 1);
    this.viewedMonth.set(prev);
    this.selectedDate.set(null);
    this._loadMonth(prev);
  }

  protected nextMonth(): void {
    const m = this.viewedMonth();
    const next = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    this.viewedMonth.set(next);
    this.selectedDate.set(null);
    this._loadMonth(next);
  }

  protected selectDay(cell: DayCell): void {
    this.selectedDate.set(this.selectedDate() === cell.iso ? null : cell.iso);
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

  protected serviceNames(entry: QueueEntry): string {
    return entry.members
      .map((m) => m.service?.name)
      .filter((name): name is string => !!name)
      .join(', ');
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
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const from = toIsoDate(new Date(year, monthIndex, 1));
    const to = toIsoDate(new Date(year, monthIndex + 1, 0));
    this.calendar.load(this._salonId, this._staffId, from, to);
  }

  private _startOfMonth(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
}
