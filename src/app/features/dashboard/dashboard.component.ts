import { Component, OnInit, inject, computed } from '@angular/core';
import { DashboardService } from './dashboard.service';
import { SalonDashboardComponent } from './salon/salon-dashboard.component';
import { CustomerDashboardComponent } from './customer/customer-dashboard.component';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  imports: [SalonDashboardComponent, CustomerDashboardComponent, SkeletonComponent],
})
export class DashboardComponent implements OnInit {
  private readonly _dashboardService = inject(DashboardService);

  protected readonly loading = this._dashboardService.loading;
  protected readonly hasSalons = computed(() => this._dashboardService.salons().length > 0);

  ngOnInit(): void {
    this._dashboardService.load();
  }
}
