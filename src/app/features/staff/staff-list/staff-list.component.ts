import { Component, DestroyRef, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../../api/api-configuration';
import { StaffWithQueueDto } from '../../../api/models/staff-with-queue-dto';
import { SalonStaff } from '../../../api/models/salon-staff';
import { staffControllerFindAll } from '../../../api/fn/staff/staff-controller-find-all';
import { HasRoleDirective } from '../../../shared/directives/has-role.directive';
import { ToastService } from '../../../core/toast/toast.service';

@Component({
  selector: 'app-staff-list',
  templateUrl: './staff-list.component.html',
  imports: [RouterLink, HasRoleDirective],
})
export class StaffListComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _toast = inject(ToastService);

  protected readonly staffList = signal<StaffWithQueueDto[]>([]);
  protected readonly loading = signal(true);

  protected get salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  ngOnInit(): void {
    staffControllerFindAll(this._http, this._apiConfig.rootUrl, { salonId: this.salonId }).pipe(
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: (res) => {
        this.staffList.set(res.body);
        this.loading.set(false);
      },
      error: () => {
        this._toast.error('Failed to load staff');
        this.loading.set(false);
      },
    });
  }

  protected roleBadgeClass(role: SalonStaff['role']): string {
    const map: Record<SalonStaff['role'], string> = {
      OWNER: 'bg-primary/10 text-primary',
      ADMIN: 'bg-blue-100 text-blue-700',
      STAFF: 'bg-gray-100 text-gray-600',
    };
    return map[role];
  }

  protected statusBadgeClass(status: SalonStaff['status']): string {
    const map: Record<SalonStaff['status'], string> = {
      ACTIVE: 'bg-green-100 text-green-700',
      PENDING: 'bg-amber-100 text-amber-700',
      INACTIVE: 'bg-gray-100 text-gray-500',
    };
    return map[status];
  }

  protected staffName(s: SalonStaff): string {
    if (s.user) return `${s.user.firstName} ${s.user.lastName}`;
    return s.email;
  }
}
