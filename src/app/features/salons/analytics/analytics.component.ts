import { Component, OnInit, inject, computed, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import { ChartData, ChartOptions } from 'chart.js';
import { AnalyticsService, DateRange } from './analytics.service';
import { StaffService } from '../../staff/staff.service';
import { ServicesService } from '../../services/services.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { MiniMonthCalendarComponent } from '../../../shared/components/mini-month-calendar/mini-month-calendar.component';
import { SalonStaff } from '../../../api/models/salon-staff';
import { RouteParam } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-analytics',
  templateUrl: './analytics.component.html',
  imports: [BaseChartDirective, PageHeaderComponent, MiniMonthCalendarComponent],
})
export class AnalyticsComponent implements OnInit {
  protected readonly analytics = inject(AnalyticsService);
  protected readonly staffService = inject(StaffService);
  protected readonly servicesService = inject(ServicesService);
  private readonly _route = inject(ActivatedRoute);

  protected readonly ranges: { label: string; value: DateRange }[] = [
    { label: '7 days',  value: '7d'  },
    { label: '30 days', value: '30d' },
    { label: '90 days', value: '90d' },
  ];

  // Calendar day-picker — collapsed by default so it doesn't compete with the
  // pills for attention; opening it doesn't itself pick a day (setDay() only
  // fires on an actual tap), so toggling it open/closed never changes filters.
  protected readonly calendarOpen = signal(false);
  protected readonly viewedMonth = signal(this._startOfMonth(new Date()));

  protected readonly staffSortOptions = [
    { label: 'Most served', value: 'served'  as const },
    { label: 'No-shows',    value: 'noShows' as const },
    { label: 'Walk-ins',    value: 'walkIns' as const },
  ];

  protected activeStaffSort: 'served' | 'noShows' | 'walkIns' = 'served';

  private get salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  // Bar chart — daily trends
  protected readonly barChartData = computed<ChartData<'bar'>>(() => {
    const trends = this.analytics.trends();
    return {
      labels: trends.map((t) =>
        new Date(t.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      ),
      datasets: [
        { label: 'Served',    data: trends.map((t) => t.served),    backgroundColor: '#7c3aed' },
        { label: 'No-shows',  data: trends.map((t) => t.noShows),   backgroundColor: '#fbbf24' },
        { label: 'Cancelled', data: trends.map((t) => t.cancelled), backgroundColor: '#fca5a5' },
      ],
    };
  });

  protected readonly barChartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { font: { size: 12 } } } },
    scales: { x: { stacked: false }, y: { beginAtZero: true, ticks: { stepSize: 1 } } },
  };

  // Pie chart — service breakdown
  protected readonly pieChartData = computed<ChartData<'pie'>>(() => {
    const breakdown = this.analytics.serviceBreakdown();
    return {
      labels: breakdown.map((s) => s.serviceName),
      datasets: [{
        data: breakdown.map((s) => s.totalMembers),
        backgroundColor: ['#7c3aed','#a78bfa','#c4b5fd','#ddd6fe','#fbbf24','#fca5a5','#6ee7b7','#93c5fd'],
      }],
    };
  });

  protected readonly pieChartOptions: ChartOptions<'pie'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { font: { size: 12 }, boxWidth: 12 } } },
  };

  protected readonly maxBreakdown = computed(() =>
    Math.max(...this.analytics.serviceBreakdown().map((s) => s.totalMembers), 1),
  );

  // Only shows a highlighted day when a day is actually the active filter —
  // if a 7d/30d/90d pill is active, nothing should look selected on the grid
  // even though `from` technically equals some date within that range.
  protected readonly selectedDateForCalendar = computed(() =>
    this.analytics.filters().range === 'day' ? this.analytics.filters().from : null,
  );

  ngOnInit(): void {
    this.analytics.load(this.salonId);
    this.staffService.load(this.salonId);
    this.servicesService.load(this.salonId);
  }

  protected setRange(range: DateRange): void {
    this.analytics.setRange(this.salonId, range);
  }

  // Tapping "Pick a day" while a day is already the active filter closes the
  // calendar AND reverts to 7d — a real toggle, not just a panel show/hide.
  // Otherwise it just opens/closes the panel without touching the filter
  // (opening the calendar to browse doesn't itself pick a day).
  protected toggleCalendar(): void {
    if (this.analytics.filters().range === 'day') {
      this.calendarOpen.set(false);
      this.clearDay();
      return;
    }
    this.calendarOpen.update((open) => !open);
  }

  protected onMonthChange(month: Date): void {
    this.viewedMonth.set(month);
  }

  protected onDaySelect(iso: string): void {
    this.analytics.setDay(this.salonId, iso);
  }

  // Falls back to 7d — the same range the page loads with — since there's no
  // single "previous range" to restore to (the pills and the day-picker don't
  // track history, just whichever is currently active).
  protected clearDay(): void {
    this.analytics.setRange(this.salonId, '7d');
  }

  protected onStaffFilterChange(staffId: string): void {
    this.analytics.setStaffFilter(this.salonId, staffId || undefined);
  }

  protected onServiceFilterChange(serviceId: string): void {
    this.analytics.setServiceFilter(this.salonId, serviceId || undefined);
  }

  protected setStaffSort(sort: 'served' | 'noShows' | 'walkIns'): void {
    this.activeStaffSort = sort;
    this.analytics.setSort(sort);
  }

  protected staffName(s: SalonStaff): string {
    return s.user ? `${s.user.firstName} ${s.user.lastName}` : s.email;
  }

  private _startOfMonth(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  // Dummy data — no endpoint yet
  // protected readonly dummySummaryCards = [
  //   { label: 'Avg Queue Size', value: '6',   sub: 'Clients/day' },
  //   { label: 'Peak Hour',      value: '2pm', sub: 'Most busy time' },
  // ];

  // protected readonly heatmapHours = [8,9,10,11,12,13,14,15,16,17,18];
  // protected readonly heatmapDays = ['M','T','W','T','F','S','S'];
  // protected readonly heatmapColors = ['bg-primary/10','bg-primary/30','bg-primary/60','bg-primary/80','bg-primary/20'];
}
