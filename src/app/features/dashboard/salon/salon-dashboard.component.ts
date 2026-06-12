import { Component, DestroyRef, inject, input, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../../api/api-configuration';
import { MySalonDto } from '../../../api/models/my-salon-dto';
import { userSalonsControllerFindMine } from '../../../api/fn/salons/user-salons-controller-find-mine';
import { MySalonsListComponent } from './my-salons-list/my-salons-list.component';
import { PendingInvitesComponent } from './pending-invites/pending-invites.component';
import { NoSalonsEmptyStateComponent } from '../shared/no-salons-empty-state/no-salons-empty-state.component';

@Component({
  selector: 'app-salon-dashboard',
  templateUrl: './salon-dashboard.component.html',
  imports: [MySalonsListComponent, PendingInvitesComponent, NoSalonsEmptyStateComponent],
})
export class SalonDashboardComponent implements OnInit {
  readonly initialSalons = input.required<MySalonDto[]>();

  private readonly _router = inject(Router);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);

  protected readonly salons = signal<MySalonDto[]>([]);
  protected readonly loading = signal(false);

  ngOnInit(): void {
    this.salons.set(this.initialSalons());
  }

  protected onInviteActioned(): void {
    this.loading.set(true);
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

  protected navigateToCreateSalon(): void {
    this._router.navigate(['/salons/new']);
  }
}
