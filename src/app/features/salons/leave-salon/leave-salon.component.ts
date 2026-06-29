import { Component, DestroyRef, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { MembershipStore } from '../../../core/salon-context/membership.store';
import { StaffService } from '../../staff/staff.service';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';

@Component({
  selector: 'app-leave-salon',
  templateUrl: './leave-salon.component.html',
  imports: [RouterLink],
})
export class LeaveSalonComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _membershipStore = inject(MembershipStore);
  private readonly _staffService = inject(StaffService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _destroyRef = inject(DestroyRef);

  // Owners cannot leave — they must transfer ownership first. Only owners see
  // that note, with the leave button disabled.
  protected readonly isOwner = signal(false);
  protected readonly leaving = this._staffService.acting;

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  protected get transferUrl(): unknown[] {
    return ['/salons', this._salonId, 'staff', 'transfer-ownership'];
  }

  ngOnInit(): void {
    this._membershipStore.getMembership(this._salonId).pipe(
      takeUntilDestroyed(this._destroyRef),
    ).subscribe((m) => this.isOwner.set(m.role === 'OWNER'));
  }

  protected confirmLeave(): void {
    if (this.isOwner() || this.leaving()) return;
    this._confirmDialog.open({
      title: 'Leave this salon?',
      message: 'You will lose access to this salon and its queue. This cannot be undone — you would need a new invite to return.',
      confirmLabel: 'Leave salon',
      danger: true,
    }).pipe(
      filter((confirmed) => confirmed),
      takeUntilDestroyed(this._destroyRef),
    ).subscribe(() => {
      this._staffService.leaveSalon(this._salonId, () => this._router.navigate(['/dashboard']));
    });
  }
}
