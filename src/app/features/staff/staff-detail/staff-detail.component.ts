import { Component, DestroyRef, inject, signal, computed, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, switchMap } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { SalonStaff } from '../../../api/models/salon-staff';
import { staffControllerFindAll } from '../../../api/fn/staff/staff-controller-find-all';
import { staffControllerUpdateRole } from '../../../api/fn/staff/staff-controller-update-role';
import { staffControllerTransferOwnership } from '../../../api/fn/staff/staff-controller-transfer-ownership';
import { staffControllerRemove } from '../../../api/fn/staff/staff-controller-remove';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { MembershipStore } from '../../../core/salon-context/membership.store';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../../core/toast/toast.service';
import { ErrorCodes } from '../../../core/errors/error-codes';
import { isApiError } from '../../../core/errors/api-error.types';

@Component({
  selector: 'app-staff-detail',
  templateUrl: './staff-detail.component.html',
  imports: [RouterLink],
})
export class StaffDetailComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _toast = inject(ToastService);
  private readonly _membershipStore = inject(MembershipStore);

  protected readonly salonContext = inject(SalonContextService);
  protected readonly staff = signal<SalonStaff | null>(null);
  protected readonly loading = signal(true);
  protected readonly actioning = signal(false);

  protected readonly isOwner = computed(() => this.salonContext.membership()?.role === 'OWNER');
  protected readonly canManage = computed(() => {
    const role = this.salonContext.membership()?.role;
    return role === 'OWNER' || role === 'ADMIN';
  });

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  private get _staffId(): string {
    return this._route.snapshot.paramMap.get('staffId') ?? '';
  }

  ngOnInit(): void {
    staffControllerFindAll(this._http, this._apiConfig.rootUrl, { salonId: this._salonId }).pipe(
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: (res) => {
        const found = res.body.find((s) => s.staff.id === this._staffId)?.staff ?? null;
        if (!found) {
          this._toast.error('Staff member not found');
          this._router.navigate(['..'], { relativeTo: this._route });
          return;
        }
        this.staff.set(found);
        this.loading.set(false);
      },
      error: () => this._router.navigate(['..'], { relativeTo: this._route }),
    });
  }

  protected staffName(s: SalonStaff): string {
    return s.user ? `${s.user.firstName} ${s.user.lastName}` : s.email;
  }

  protected changeRole(newRole: 'ADMIN' | 'STAFF'): void {
    if (this.actioning()) return;
    const s = this.staff();
    if (!s) return;

    this._confirmDialog.open({
      title: `Change role to ${newRole}?`,
      message: `${this.staffName(s)} will become ${newRole} of this salon.`,
      confirmLabel: 'Change role',
    }).pipe(
      filter((ok) => ok),
      switchMap(() => {
        this.actioning.set(true);
        return staffControllerUpdateRole(this._http, this._apiConfig.rootUrl, {
          salonId: this._salonId,
          staffId: this._staffId,
          body: { role: newRole },
        });
      }),
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: () => {
        this.staff.update((s) => s ? { ...s, role: newRole } : s);
        this._membershipStore.invalidate(this._salonId);
        this.actioning.set(false);
        this._toast.success('Role updated');
      },
      error: (err: unknown) => {
        this.actioning.set(false);
        const body = (err as { error?: unknown })?.error;
        if (isApiError(body) && body.code === ErrorCodes.CANNOT_REMOVE_OWNER) {
          this._toast.error('Cannot change the owner\'s role. Use Transfer Ownership instead.');
        }
      },
    });
  }

  protected transferOwnership(): void {
    if (this.actioning()) return;
    const s = this.staff();
    if (!s) return;

    this._confirmDialog.open({
      title: 'Transfer ownership?',
      message: `${this.staffName(s)} will become the new OWNER. You will become ADMIN. This cannot be undone without their cooperation.`,
      confirmLabel: 'Transfer ownership',
      danger: true,
    }).pipe(
      filter((ok) => ok),
      switchMap(() => {
        this.actioning.set(true);
        return staffControllerTransferOwnership(this._http, this._apiConfig.rootUrl, {
          salonId: this._salonId,
          body: { newOwnerId: this._staffId },
        });
      }),
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: () => {
        this._membershipStore.invalidate(this._salonId);
        this.actioning.set(false);
        this._toast.success('Ownership transferred');
        this._router.navigate(['..'], { relativeTo: this._route });
      },
      error: () => this.actioning.set(false),
    });
  }

  protected removeStaff(): void {
    if (this.actioning()) return;
    const s = this.staff();
    if (!s) return;

    this._confirmDialog.open({
      title: `Remove ${this.staffName(s)}?`,
      message: 'Their queue will be closed, entries cancelled, and customers notified.',
      confirmLabel: 'Remove',
      danger: true,
    }).pipe(
      filter((ok) => ok),
      switchMap(() => {
        this.actioning.set(true);
        return staffControllerRemove(this._http, this._apiConfig.rootUrl, {
          salonId: this._salonId,
          staffId: this._staffId,
        });
      }),
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: () => {
        this._membershipStore.invalidate(this._salonId);
        this.actioning.set(false);
        this._toast.success('Staff member removed');
        this._router.navigate(['..'], { relativeTo: this._route });
      },
      error: (err: unknown) => {
        this.actioning.set(false);
        const body = (err as { error?: unknown })?.error;
        if (isApiError(body) && body.code === ErrorCodes.CANNOT_REMOVE_OWNER) {
          this._toast.error('Cannot remove the owner. Transfer ownership first.');
        }
      },
    });
  }
}
