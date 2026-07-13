import { Component, OnInit, inject, computed } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import { ChartData, ChartOptions } from 'chart.js';
import { AnalyticsService, DateRange } from './analytics.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { RouteParam } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-analytics',
  templateUrl: './analytics.component.html',
  providers: [AnalyticsService],
  imports: [BaseChartDirective, PageHeaderComponent],
})
export class AnalyticsComponent implements OnInit {
  protected readonly analytics = inject(AnalyticsService);
  private readonly _route = inject(ActivatedRoute);

  protected readonly ranges: { label: string; value: DateRange }[] = [
    { label: '7 days',  value: '7d'  },
    { label: '30 days', value: '30d' },
    { label: '90 days', value: '90d' },
  ];

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

  ngOnInit(): void {
    this.analytics.load(this.salonId);
  }

  protected setRange(range: DateRange): void {
    this.analytics.setRange(this.salonId, range);
  }

  protected setStaffSort(sort: 'served' | 'noShows' | 'walkIns'): void {
    this.activeStaffSort = sort;
    this.analytics.setSort(sort);
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
