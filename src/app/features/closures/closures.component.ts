import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { PageDescriptionComponent } from '../../shared/components/page-description/page-description.component';
import { ScreenLayoutComponent } from '../../shared/components/screen-layout/screen-layout.component';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ToastService } from '../../core/toast/toast.service';
import { SalonContextService } from '../../core/salon-context/salon-context.service';
import { ClosuresService } from './closures.service';
import { ConfirmDialogService } from '../../shared/components/confirm-dialog/confirm-dialog.service';
import { Closure } from '../../api/models/closure';
import { FrozenBannerComponent } from '../../shared/components/frozen-banner/frozen-banner.component';
import { TierFreezeDirective } from '../../shared/directives/tier-freeze.directive';
import { FieldErrorComponent } from '../../shared/components/field-error/field-error.component';
import { AnimatedListComponent } from '../../shared/components/animated-list/animated-list.component';
import { filter } from 'rxjs';
import { RouteParam } from '../../core/routing/route-paths';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';

@Component({
  selector: 'app-closures',
  templateUrl: './closures.component.html',
  imports: [
    SkeletonComponent,
    ReactiveFormsModule,
    FrozenBannerComponent,
    TierFreezeDirective,
    FieldErrorComponent,
    AnimatedListComponent,
    PageHeaderComponent,
    PageDescriptionComponent,
    ScreenLayoutComponent,
  ],
})
export class ClosuresComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _fb = inject(FormBuilder);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _toast = inject(ToastService);
  private readonly _closuresService = inject(ClosuresService);
  protected readonly salonContext = inject(SalonContextService);

  // A staffId in the route means this page was reached from a specific staff
  // member's own page — a salon-wide closure belongs on the salon-reached
  // version of this page instead (no staffId), so this page shows ONLY that
  // staff member's closures here, with no scope switcher at all.
  protected readonly showAddForm = signal(false);

  protected readonly loading = computed(() =>
    this.isStaffScope ? this._closuresService.staffLoading() : this._closuresService.salonLoading(),
  );
  protected readonly error = computed(() =>
    this.isStaffScope ? this._closuresService.staffError() : this._closuresService.salonError(),
  );
  protected readonly closures = computed(() =>
    this.isStaffScope ? this._closuresService.staffClosures() : this._closuresService.salonClosures(),
  );

  protected readonly addForm = this._fb.group({
    date: ['', Validators.required],
    reason: [''],
  });

  protected get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  protected get _staffId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.STAFF_ID) ?? '';
  }

  protected get isStaffScope(): boolean {
    return !!this._staffId;
  }

  ngOnInit(): void {
    if (this.isStaffScope) {
      this._closuresService.loadStaff(this._salonId, this._staffId);
    } else {
      this._closuresService.loadSalon(this._salonId);
    }
  }

  protected retry(): void {
    if (this.isStaffScope) {
      this._closuresService.refreshStaff(this._salonId, this._staffId);
    } else {
      this._closuresService.refreshSalon(this._salonId);
    }
  }

  protected add(): void {
    if (this.addForm.invalid) {
      this.addForm.markAllAsTouched();
      return;
    }
    const { date, reason } = this.addForm.getRawValue();
    const body = { date: date!, reason: reason || undefined };
    if (this.isStaffScope) {
      this._closuresService.createStaff(this._salonId, this._staffId, body);
    } else {
      this._closuresService.createSalon(this._salonId, body);
    }
    // Optimistic: the closure row already painted, so close the form and tell
    // the user now rather than waiting on the network round-trip. If the
    // create actually fails, the service's revert path shows its own error toast.
    this.showAddForm.set(false);
    this.addForm.reset();
    this._toast.success('Closure added');
  }

  protected delete(closure: Closure): void {
    this._confirmDialog
      .open({
        title: `Remove closure on ${closure.date}?`,
        message: closure.reason ? `Reason: ${closure.reason}` : 'This closure will be removed.',
        confirmLabel: 'Remove',
        danger: true,
      })
      .pipe(filter((ok) => ok))
      .subscribe(() => {
        if (this.isStaffScope) {
          this._closuresService.deleteStaff(this._salonId, this._staffId, closure.id);
        } else {
          this._closuresService.deleteSalon(this._salonId, closure.id);
        }
      });
  }
}
