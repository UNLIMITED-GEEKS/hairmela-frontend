import { Component, DestroyRef, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../../api/api-configuration';
import { Salon } from '../../../api/models/salon';
import { salonsControllerFindOne } from '../../../api/fn/salons/salons-controller-find-one';
import { staffControllerFindAll } from '../../../api/fn/staff/staff-controller-find-all';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { HasRoleDirective } from '../../../shared/directives/has-role.directive';
import { ToastService } from '../../../core/toast/toast.service';

@Component({
  selector: 'app-salon-overview',
  templateUrl: './salon-overview.component.html',
  imports: [RouterLink, HasRoleDirective],
})
export class SalonOverviewComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _toast = inject(ToastService);
  private readonly _currentUser = inject(CurrentUserStore);

  protected readonly salonContext = inject(SalonContextService);
  protected readonly salon = signal<Salon | null>(null);
  protected readonly loading = signal(true);
  protected readonly myQueueId = signal<string | null>(null);

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  ngOnInit(): void {
    salonsControllerFindOne(this._http, this._apiConfig.rootUrl, { salonId: this._salonId }).pipe(
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: (res) => {
        this.salon.set(res.body);
        this.loading.set(false);
      },
      error: () => {
        this._toast.error('Salon not found');
        this._router.navigate(['/dashboard']);
      },
    });

    staffControllerFindAll(this._http, this._apiConfig.rootUrl, { salonId: this._salonId }).pipe(
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: (res) => {
        const userId = this._currentUser.user()?.id;
        const mine = res.body.find((s) => s.staff.userId === userId);
        this.myQueueId.set(mine?.queueId ?? null);
      },
    });
  }
}
