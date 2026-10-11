import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ChartData, ChartOptions } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { CurrencyNgnPipe } from '../../../shared/pipes/currency-ngn.pipe';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { MiniMonthCalendarComponent } from '../../../shared/components/mini-month-calendar/mini-month-calendar.component';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { ThemeService } from '../../../core/theme/theme.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { RouteParam } from '../../../core/routing/route-paths';
import { SalonOverviewService } from '../salon-overview/salon-overview.service';
import { MyAnalyticsService, daysThrough, salonToday } from './my-analytics.service';

@Component({
  selector: 'app-my-analytics',
  templateUrl: './my-analytics.component.html',
  imports: [BaseChartDirective, PageHeaderComponent, MiniMonthCalendarComponent, CurrencyNgnPipe],
  providers: [MyAnalyticsService],
})
export class MyAnalyticsComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _overview = inject(SalonOverviewService);
  protected readonly salonContext = inject(SalonContextService);
  protected readonly theme = inject(ThemeService);
  protected readonly analytics = inject(MyAnalyticsService);
  protected readonly rangeDays = signal<7 | 30 | 90>(7);
  protected readonly ranges = [7, 30, 90] as const;
  protected readonly selectedDay = signal<string | null>(null);
  protected readonly calendarOpen = signal(false);
  protected readonly viewedMonth = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  protected readonly salon = this._overview.salon;
  protected readonly overviewError = this._overview.error;

  protected readonly barChartData = computed<ChartData<'bar'>>(() => ({
    labels: (this.analytics.data()?.trends ?? []).map((day) =>
      new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    ),
    datasets: [
      { label: 'Served', data: (this.analytics.data()?.trends ?? []).map((day) => day.served), backgroundColor: '#7c3aed' },
      { label: 'No-shows', data: (this.analytics.data()?.trends ?? []).map((day) => day.noShows), backgroundColor: '#fbbf24' },
      { label: 'Cancelled', data: (this.analytics.data()?.trends ?? []).map((day) => day.cancelled), backgroundColor: '#fca5a5' },
    ],
  }));

  protected readonly barChartOptions = computed<ChartOptions<'bar'>>(() => {
    this.theme.mode();
    const styles = getComputedStyle(document.documentElement);
    const ink = styles.getPropertyValue('--color-text-secondary').trim();
    const grid = styles.getPropertyValue('--color-border').trim();
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 12 }, color: ink } } },
      scales: {
        x: { stacked: false, ticks: { color: ink }, grid: { color: grid } },
        y: { beginAtZero: true, ticks: { stepSize: 1, color: ink }, grid: { color: grid } },
      },
    };
  });

  protected readonly pieChartData = computed<ChartData<'pie'>>(() => ({
    labels: (this.analytics.data()?.serviceBreakdown ?? []).map((service) => service.serviceName),
    datasets: [{
      data: (this.analytics.data()?.serviceBreakdown ?? []).map((service) => service.totalMembers),
      backgroundColor: ['#7c3aed', '#a78bfa', '#c4b5fd', '#ddd6fe', '#fbbf24', '#fca5a5', '#6ee7b7', '#93c5fd'],
    }],
  }));

  protected readonly pieChartOptions = computed<ChartOptions<'pie'>>(() => {
    this.theme.mode();
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--color-text-secondary').trim();
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 12 }, boxWidth: 12, color: ink } } },
    };
  });

  protected readonly maxBreakdown = computed(() =>
    Math.max(1, ...(this.analytics.data()?.serviceBreakdown.map((service) => service.totalMembers) ?? [])),
  );

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  protected get salonId(): string {
    return this._salonId;
  }

  constructor() {
    effect(() => {
      const salon = this.salon();
      const days = this.rangeDays();
      const selectedDay = this.selectedDay();
      if (!salon || salon.id !== this._salonId) return;
      const today = salonToday(salon.timezone);
      this.analytics.load(
        this._salonId,
        selectedDay ?? daysThrough(today, 1 - days),
        selectedDay ?? today,
        salon.timezone,
      );
    });
  }

  ngOnInit(): void {
    this._overview.load(this._salonId, this._currentUser.user()?.id ?? '');
  }

  protected setRange(days: 7 | 30 | 90): void {
    this.selectedDay.set(null);
    this.rangeDays.set(days);
  }

  protected toggleCalendar(): void {
    if (this.selectedDay()) {
      this.calendarOpen.set(false);
      this.clearDay();
      return;
    }
    this.calendarOpen.update((open) => !open);
  }

  protected clearDay(): void {
    this.setRange(7);
  }

  protected onDaySelect(day: string): void {
    this.selectedDay.set(day);
  }

  protected onMonthChange(month: Date): void {
    this.viewedMonth.set(month);
  }

  protected retry(): void {
    const salon = this.salon();
    if (!salon || salon.id !== this._salonId) {
      this._overview.refresh(this._salonId, this._currentUser.user()?.id ?? '');
      return;
    }
    const today = salonToday(salon.timezone);
    const day = this.selectedDay();
    this.analytics.load(this._salonId, day ?? daysThrough(today, 1 - this.rangeDays()), day ?? today, salon.timezone);
  }
}
