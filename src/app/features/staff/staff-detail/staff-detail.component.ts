import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SalonStaff } from '../../../api/models/salon-staff';
import { StaffService } from '../staff.service';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonRole } from '../../../core/salon-context/membership.types';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../../core/toast/toast.service';
import { ErrorCodes } from '../../../core/errors/error-codes';
import { isApiError } from '../../../core/errors/api-error.types';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { filter, switchMap } from 'rxjs';
import { RouteParam, RoutePath, RouteSegment } from '../../../core/routing/route-paths';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';

@Component({
  selector: 'app-staff-detail',
  templateUrl: './staff-detail.component.html',
  imports: [
    SkeletonComponent, RouterLink, PageHeaderComponent],
})
export class StaffDetailComponent implements OnInit {
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _staffService = inject(StaffService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _toast = inject(ToastService);

  protected readonly salonContext = inject(SalonContextService);
  protected readonly loading = this._staffService.loading;
  protected readonly actioning = this._staffService.acting;

  protected readonly staff = computed(() =>
    this._staffService.staffList().find((s) => s.staff.id === this._staffId)?.staff ?? null,
  );

  protected readonly isOwner = computed(() => this.salonContext.membership()?.role === SalonRole.OWNER);
  protected readonly canManage = computed(() => {
    const role = this.salonContext.membership()?.role;
    return role === SalonRole.OWNER || role === SalonRole.ADMIN;
  });

  protected readonly servicesLink = [RouteSegment.SERVICES];
  protected readonly schedulesLink = [RouteSegment.SCHEDULES];
  protected readonly closuresLink = [RouteSegment.CLOSURES];
  protected readonly mediaLink = [RouteSegment.MEDIA];
  protected readonly appointmentsLink = [RouteSegment.APPOINTMENTS];

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  private get _staffId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.STAFF_ID) ?? '';
  }

  ngOnInit(): void {
    this._staffService.load(this._salonId);
  }

  protected staffName(s: SalonStaff): string {
    return s.user ? `${s.user.firstName} ${s.user.lastName}` : s.email;
  }

  protected changeRole(newRole: 'ADMIN' | 'STAFF'): void {
    const s = this.staff();
    if (!s) return;
    this._confirmDialog.open({
      title: `Change role to ${newRole}?`,
      message: `${this.staffName(s)} will become ${newRole} of this salon.`,
      confirmLabel: 'Change role',
    }).pipe(
      filter((ok) => ok),
      switchMap(() => {
        return new Promise<void>((resolve) => {
          this._staffService.updateRole(this._salonId, this._staffId, { role: newRole }, resolve);
        });
      }),
    ).subscribe({
      error: (err: unknown) => {
        const body = (err as { error?: unknown })?.error;
        if (isApiError(body) && body.code === ErrorCodes.CANNOT_REMOVE_OWNER) {
          this._toast.error('Cannot change the owner\'s role. Use Transfer Ownership instead.');
        }
      },
    });
  }

  protected transferOwnership(): void {
    const s = this.staff();
    if (!s) return;
    this._confirmDialog.open({
      title: 'Transfer ownership?',
      message: `${this.staffName(s)} will become the new OWNER. You will become ADMIN. This cannot be undone without their cooperation.`,
      confirmLabel: 'Transfer ownership',
      danger: true,
    }).pipe(filter((ok) => ok)).subscribe(() => {
      this._staffService.transferOwnership(
        this._salonId,
        { newOwnerId: this._staffId },
        () => this._router.navigate(RoutePath.salonStaff(this._salonId), { replaceUrl: true }),
      );
    });
  }

  protected removeStaff(): void {
    const s = this.staff();
    if (!s) return;
    this._confirmDialog.open({
      title: `Remove ${this.staffName(s)}?`,
      message: 'Their queue will be closed, entries cancelled, and customers notified.',
      confirmLabel: 'Remove',
      danger: true,
    }).pipe(filter((ok) => ok)).subscribe(() => {
      this._staffService.remove(
        this._salonId,
        this._staffId,
        () => this._router.navigate(RoutePath.salonStaff(this._salonId), { replaceUrl: true }),
      );
    });
  }
}
