import { Component, DestroyRef, inject, signal, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../api/api-configuration';
import { MySalonDto } from '../../api/models/my-salon-dto';
import { userSalonsControllerFindMine } from '../../api/fn/salons/user-salons-controller-find-mine';
import { SalonDashboardComponent } from './salon/salon-dashboard.component';
import { CustomerDashboardComponent } from './customer/customer-dashboard.component';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  imports: [SalonDashboardComponent, CustomerDashboardComponent],
})
export class DashboardComponent implements OnInit {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);

  protected readonly salons = signal<MySalonDto[]>([]);
  protected readonly loading = signal(true);

  ngOnInit(): void {
    userSalonsControllerFindMine(this._http, this._apiConfig.rootUrl).pipe(
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: (res) => {
        this.salons.set(res.body);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
