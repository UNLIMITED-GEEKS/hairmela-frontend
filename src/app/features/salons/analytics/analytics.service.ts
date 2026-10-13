import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { forkJoin, map, Observable, of, tap } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { CacheRegistry } from '../../../core/caching/cache-registry/cache-registry.service';
import { QueueSummaryDto } from '../../../api/models/queue-summary-dto';
import { TrendDataPointDto } from '../../../api/models/trend-data-point-dto';
import { ServiceBreakdownItemDto } from '../../../api/models/service-breakdown-item-dto';
import { StaffPerformanceItemDto } from '../../../api/models/staff-performance-item-dto';
import { analyticsControllerGetSummary } from '../../../api/fn/analytics/analytics-controller-get-summary';
import { analyticsControllerGetTrends } from '../../../api/fn/analytics/analytics-controller-get-trends';
import { analyticsControllerGetServiceBreakdown } from '../../../api/fn/analytics/analytics-controller-get-service-breakdown';
import { analyticsControllerGetStaffPerformance } from '../../../api/fn/analytics/analytics-controller-get-staff-performance';

// How long a given filter combination's results are trusted before a
// re-visit re-fetches. Analytics is backward-looking (past-range summaries,
// trends, breakdowns) — nothing here needs to react live to a queue event the
// way the live queue view does, so a 30min window is safe: a barber flipping
// between "7 days" and "30 days" and back, or re-opening the page, gets an
// instant repaint from cache instead of a redundant round-trip.
const CACHE_TTL_MS = 30 * 60 * 1000;
const OVERVIEW_SUMMARY_TTL_MS = 60 * 1000;

interface AnalyticsSnapshot {
  summary: QueueSummaryDto;
  trends: TrendDataPointDto[];
  serviceBreakdown: ServiceBreakdownItemDto[];
  staffPerformance: StaffPerformanceItemDto[];
  fetchedAt: number;
}

// 'day' is a single picked calendar date (from === to), mutually exclusive
// with the 7d/30d/90d pills — selecting one clears the other in the UI.
export type DateRange = '7d' | '30d' | '90d' | 'day';

export interface AnalyticsFilters {
  range: DateRange;
  from: string;
  to: string;
  timezone: string;
  // Both optional: undefined means "all staff" / "all services", matching
  // the backend's optional staffId/serviceId query params on every endpoint.
  staffId?: string;
  serviceId?: string;
}

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rangeToFromTo(range: DateRange, day?: string): { from: string; to: string } {
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
  // 'day' — single picked date, defaults to today if none picked yet.
  const picked = day ?? to;
  return { from: picked, to: picked };
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _cacheRegistry = inject(CacheRegistry);

  constructor() {
    this._cacheRegistry.register(this);
  }

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

  // Keyed by every input that changes what the 4 endpoints return — salonId
  // included, since this is now a root singleton (was component-provided
  // before, which meant a fresh instance — and an always-cold cache — on
  // every navigation to the page; a TTL is pointless if it can never survive
  // a "leave and come back"). Not persisted beyond the session; CacheRegistry
  // wipes it on logout like every other cache in the app.
  //
  // FIXME: this hand-rolls a keyed-TTL cache (Map<key, {value, fetchedAt}> +
  // manual Date.now() comparison in load()) that doesn't exist as a shared
  // primitive anywhere in core/caching/ — CachedLoader caches indefinitely
  // (no expiry), TtlGate is a single un-keyed flag (one "is this fresh?" per
  // service instance, not per filter combination), and CacheRegistry only
  // knows clear()/clearAll() — it has no concept of a keyed cache invalidating
  // entries on its own schedule, so it can only ever nuke this Map wholesale
  // via clear(), never expire one stale key while leaving others intact.
  // If a second feature needs a keyed TTL cache (this shape — N independent
  // cache entries, each with its own freshness window — is a reasonable bet
  // to recur, e.g. anywhere else with a filter-combination-keyed report), this
  // duplicated Map/fetchedAt/isFresh logic should be extracted into a real
  // primitive (a "KeyedTtlCache<K, V>" alongside CachedLoader/TtlGate in
  // core/caching/) rather than copy-pasted again. Revisit then; not worth
  // building the shared abstraction for a single caller right now.
  private readonly _cache = new Map<string, AnalyticsSnapshot>();
  private readonly _overviewSummaryCache = new Map<string, { summary: QueueSummaryDto; fetchedAt: number }>();

  private _cacheKey(salonId: string, f: AnalyticsFilters): string {
    return `${salonId}|${f.from}|${f.to}|${f.staffId ?? ''}|${f.serviceId ?? ''}`;
  }

  // The overview always needs an unfiltered salon summary. Keep it separate
  // from the analytics page's mutable staff/service/range filters, and use a
  // shorter TTL because the same response includes "waiting now".
  overviewSummary(
    salonId: string,
    from: string,
    to: string,
    timezone: string,
    bypassCache = false,
  ): Observable<QueueSummaryDto> {
    const key = `${salonId}|${from}|${to}|${timezone}`;
    const cached = this._overviewSummaryCache.get(key);
    if (!bypassCache && cached && Date.now() - cached.fetchedAt < OVERVIEW_SUMMARY_TTL_MS) {
      return of(cached.summary);
    }
    return analyticsControllerGetSummary(this._http, this._apiConfig.rootUrl, {
      salonId,
      from,
      to,
      timezone,
    }).pipe(
      map((response) => response.body),
      tap((summary) => this._overviewSummaryCache.set(key, { summary, fetchedAt: Date.now() })),
    );
  }

  invalidateOverviewSummary(salonId?: string): void {
    if (!salonId) {
      this._overviewSummaryCache.clear();
      return;
    }
    for (const key of this._overviewSummaryCache.keys()) {
      if (key.startsWith(salonId + '|')) {
        this._overviewSummaryCache.delete(key);
      }
    }
  }

  load(salonId: string): void {
    const filters = this.filters();
    const key = this._cacheKey(salonId, filters);
    const cached = this._cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      this.summary.set(cached.summary);
      this.trends.set(cached.trends);
      this.serviceBreakdown.set(cached.serviceBreakdown);
      this.staffPerformance.set(cached.staffPerformance);
      this.loading.set(false);
      return;
    }

    const { from, to, timezone, staffId, serviceId } = filters;
    this.loading.set(true);
    forkJoin({
      summary: analyticsControllerGetSummary(this._http, this._apiConfig.rootUrl, {
        salonId,
        from,
        to,
        timezone,
        staffId,
        serviceId,
      }),
      trends: analyticsControllerGetTrends(this._http, this._apiConfig.rootUrl, {
        salonId,
        from,
        to,
        timezone,
        staffId,
        serviceId,
      }),
      breakdown: analyticsControllerGetServiceBreakdown(this._http, this._apiConfig.rootUrl, {
        salonId,
        from,
        to,
        timezone,
        staffId,
        serviceId,
      }),
      staff: analyticsControllerGetStaffPerformance(this._http, this._apiConfig.rootUrl, {
        salonId,
        from,
        to,
        timezone,
        staffId,
        serviceId,
      }),
    }).subscribe({
      next: ({ summary, trends, breakdown, staff }) => {
        this._cache.set(key, {
          summary: summary.body,
          trends: trends.body,
          serviceBreakdown: breakdown.body,
          staffPerformance: staff.body,
          fetchedAt: Date.now(),
        });
        this.summary.set(summary.body);
        this.trends.set(trends.body);
        this.serviceBreakdown.set(breakdown.body);
        this.staffPerformance.set(staff.body);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  // Bypasses the cache for this exact filter combination — for a manual
  // "refresh" affordance if one is ever added. Not currently wired to any UI.
  refresh(salonId: string): void {
    this._cache.delete(this._cacheKey(salonId, this.filters()));
    this.load(salonId);
  }

  clear(): void {
    this._cache.clear();
    this._overviewSummaryCache.clear();
  }

  // Pill ranges (7d/30d/90d) — mutually exclusive with a picked day, so this
  // clears any previously-picked date.
  setRange(salonId: string, range: DateRange): void {
    const { from, to } = rangeToFromTo(range);
    this.filters.update((f) => ({ ...f, range, from, to }));
    this.load(salonId);
  }

  // A single picked calendar day — mutually exclusive with the pills.
  setDay(salonId: string, iso: string): void {
    this.filters.update((f) => ({ ...f, range: 'day', from: iso, to: iso }));
    this.load(salonId);
  }

  setStaffFilter(salonId: string, staffId: string | undefined): void {
    this.filters.update((f) => ({ ...f, staffId }));
    this.load(salonId);
  }

  setServiceFilter(salonId: string, serviceId: string | undefined): void {
    this.filters.update((f) => ({ ...f, serviceId }));
    this.load(salonId);
  }

  setSort(sort: 'served' | 'noShows' | 'walkIns'): void {
    this.staffPerformance.update((list) =>
      [...list].sort((a, b) => b[sort === 'served' ? 'totalServed' : sort === 'noShows' ? 'totalNoShows' : 'totalWalkIns']
        - a[sort === 'served' ? 'totalServed' : sort === 'noShows' ? 'totalNoShows' : 'totalWalkIns']),
    );
  }
}
