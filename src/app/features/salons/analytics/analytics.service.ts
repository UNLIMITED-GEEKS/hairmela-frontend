import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { QueueSummaryDto } from '../../../api/models/queue-summary-dto';
import { TrendDataPointDto } from '../../../api/models/trend-data-point-dto';
import { ServiceBreakdownItemDto } from '../../../api/models/service-breakdown-item-dto';
import { StaffPerformanceItemDto } from '../../../api/models/staff-performance-item-dto';
import { analyticsControllerGetSummary } from '../../../api/fn/analytics/analytics-controller-get-summary';
import { analyticsControllerGetTrends } from '../../../api/fn/analytics/analytics-controller-get-trends';
import { analyticsControllerGetServiceBreakdown } from '../../../api/fn/analytics/analytics-controller-get-service-breakdown';
import { analyticsControllerGetStaffPerformance } from '../../../api/fn/analytics/analytics-controller-get-staff-performance';

export type DateRange = '7d' | '30d' | '90d' | 'custom';

export interface AnalyticsFilters {
  range: DateRange;
  from: string;
  to: string;
  timezone: string;
}

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rangeToFromTo(range: DateRange, customFrom?: string, customTo?: string): { from: string; to: string } {
  const today = new Date();
  const to = toYMD(today);
  if (range === '7d') {
    const from = new Date(today); from.setDate(today.getDate() - 6);
    return { from: toYMD(from), to };
  }
  if (range === '30d') {
    const from = new Date(today); from.setDate(today.getDate() - 29);
    return { from: toYMD(from), to };
  }
  if (range === '90d') {
    const from = new Date(today); from.setDate(today.getDate() - 89);
    return { from: toYMD(from), to };
  }
  return { from: customFrom ?? to, to: customTo ?? to };
}

@Injectable()
export class AnalyticsService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);

  readonly loading = signal(false);
  readonly summary = signal<QueueSummaryDto | null>(null);
  readonly trends = signal<TrendDataPointDto[]>([]);
  readonly serviceBreakdown = signal<ServiceBreakdownItemDto[]>([]);
  readonly staffPerformance = signal<StaffPerformanceItemDto[]>([]);

  readonly filters = signal<AnalyticsFilters>({
    range: '7d',
    ...rangeToFromTo('7d'),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  load(salonId: string): void {
    const { from, to, timezone } = this.filters();
    this.loading.set(true);
    forkJoin({
      summary: analyticsControllerGetSummary(this._http, this._apiConfig.rootUrl, {
        salonId,
        date: to,
        timezone,
      }),
      trends: analyticsControllerGetTrends(this._http, this._apiConfig.rootUrl, { salonId, from, to, timezone }),
      breakdown: analyticsControllerGetServiceBreakdown(this._http, this._apiConfig.rootUrl, { salonId, from, to, timezone }),
      staff: analyticsControllerGetStaffPerformance(this._http, this._apiConfig.rootUrl, { salonId, from, to, timezone }),
    }).subscribe({
      next: ({ summary, trends, breakdown, staff }) => {
        this.summary.set(summary.body);
        this.trends.set(trends.body);
        this.serviceBreakdown.set(breakdown.body);
        this.staffPerformance.set(staff.body);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  setRange(salonId: string, range: DateRange): void {
    const { from, to } = rangeToFromTo(range);
    this.filters.update((f) => ({ ...f, range, from, to }));
    this.load(salonId);
  }

  setSort(sort: 'served' | 'noShows' | 'walkIns'): void {
    this.staffPerformance.update((list) =>
      [...list].sort((a, b) => b[sort === 'served' ? 'totalServed' : sort === 'noShows' ? 'totalNoShows' : 'totalWalkIns']
        - a[sort === 'served' ? 'totalServed' : sort === 'noShows' ? 'totalNoShows' : 'totalWalkIns']),
    );
  }
}
