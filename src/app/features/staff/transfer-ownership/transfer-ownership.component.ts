import { Component, computed, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { filter } from 'rxjs';
import { SalonStaff } from '../../../api/models/salon-staff';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { StaffService } from '../staff.service';

@Component({
  selector: 'app-transfer-ownership',
  templateUrl: './transfer-ownership.component.html',
  imports: [PageHeaderComponent, SkeletonComponent],
})
export class TransferOwnershipComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _staffService = inject(StaffService);
  private readonly _confirmDialog = inject(ConfirmDialogService);

  protected readonly loading = this._staffService.loading;
  protected readonly error = this._staffService.error;
  protected readonly transferring = this._staffService.acting;
  protected readonly candidates = computed(() =>
    this._staffService
      .staffList()
      .map((entry) => entry.staff)
      .filter((staff) => staff.status === 'ACTIVE' && staff.role !== 'OWNER'),
  );

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  ngOnInit(): void {
    this._staffService.load(this._salonId);
  }

  protected staffName(staff: SalonStaff): string {
    return staff.user ? `${staff.user.firstName} ${staff.user.lastName}` : staff.email;
  }

  protected retry(): void {
    this._staffService.refresh(this._salonId);
  }

  protected transferTo(staff: SalonStaff): void {
    if (this.transferring()) return;

    const name = this.staffName(staff);
    this._confirmDialog
      .open({
        title: `Transfer ownership to ${name}?`,
        message: `${name} will become the owner and you will become an admin. This cannot be undone without their cooperation.`,
        confirmLabel: 'Transfer ownership',
        danger: true,
      })
      .pipe(filter((confirmed) => confirmed))
      .subscribe(() => {
        this._staffService.transferOwnership(this._salonId, { newOwnerId: staff.id }, () => {
          this._router.navigate(RoutePath.salonLeave(this._salonId), { replaceUrl: true });
        });
      });
  }
}
