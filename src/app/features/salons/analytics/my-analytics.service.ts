import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../../api/api-configuration';
import { MyAnalyticsDto } from '../../../api/models/my-analytics-dto';
import { analyticsControllerGetMine } from '../../../api/fn/analytics/analytics-controller-get-mine';

export function salonToday(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function daysThrough(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class MyAnalyticsService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private _requestId = 0;

  readonly data = signal<MyAnalyticsDto | null>(null);
  readonly loading = signal(false);
  readonly error = signal(false);

  load(salonId: string, from: string, to: string, timezone: string, silent = false): void {
    const requestId = ++this._requestId;
    if (!silent) {
      this.loading.set(true);
    }
    this.error.set(false);
    analyticsControllerGetMine(this._http, this._apiConfig.rootUrl, {
      salonId,
      from,
      to,
      timezone,
    }).subscribe({
      next: (response) => {
        if (requestId !== this._requestId) return;
        this.data.set(response.body);
        this.loading.set(false);
      },
      error: () => {
        if (requestId !== this._requestId) return;
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }
}
