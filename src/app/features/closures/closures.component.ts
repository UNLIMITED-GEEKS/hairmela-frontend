import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ToastService } from '../../core/toast/toast.service';
import { SalonContextService } from '../../core/salon-context/salon-context.service';
import { ClosuresService } from './closures.service';
import { ConfirmDialogService } from '../../shared/components/confirm-dialog/confirm-dialog.service';
import { Closure } from '../../api/models/closure';
import { FrozenBannerComponent } from '../../shared/components/frozen-banner/frozen-banner.component';
import { TierFreezeDirective } from '../../shared/directives/tier-freeze.directive';
import { FieldErrorComponent } from '../../shared/components/field-error/field-error.component';
import { filter } from 'rxjs';

type ClosureScope = 'salon' | 'staff';

@Component({
  selector: 'app-closures',
  templateUrl: './closures.component.html',
  imports: [ReactiveFormsModule, SkeletonComponent, FrozenBannerComponent, TierFreezeDirective, FieldErrorComponent],
})
export class ClosuresComponent implements OnInit {
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _fb = inject(FormBuilder);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _toast = inject(ToastService);
  private readonly _closuresService = inject(ClosuresService);
  protected readonly salonContext = inject(SalonContextService);

  protected readonly activeTab = signal<ClosureScope>('salon');
  protected readonly showAddForm = signal(false);

  protected readonly loading = computed(() =>
    this.activeTab() === 'salon'
      ? this._closuresService.salonLoading()
      : this._closuresService.staffLoading(),
  );
  protected readonly error = computed(() =>
    this.activeTab() === 'salon'
      ? this._closuresService.salonError()
      : this._closuresService.staffError(),
  );
  protected readonly salonClosures = this._closuresService.salonClosures;
  protected readonly staffClosures = this._closuresService.staffClosures;

  protected readonly addForm = this._fb.group({
    date: ['', Validators.required],
    reason: [''],
  });

  protected get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  protected get _staffId(): string {
    return this._route.snapshot.paramMap.get('staffId') ?? '';
  }

  ngOnInit(): void {
    this._closuresService.loadSalon(this._salonId);
    if (this._staffId) this._closuresService.loadStaff(this._salonId, this._staffId);
  }

  protected retry(): void {
    this._closuresService.refreshSalon(this._salonId);
    if (this._staffId) this._closuresService.refreshStaff(this._salonId, this._staffId);
  }

  protected setTab(tab: ClosureScope): void {
    this.activeTab.set(tab);
    this.showAddForm.set(false);
  }

  protected add(): void {
    if (this.addForm.invalid) return;
    const { date, reason } = this.addForm.getRawValue();
    const body = { date: date!, reason: reason || undefined };
    const onSuccess = () => {
      this.showAddForm.set(false);
      this.addForm.reset();
      this._toast.success('Closure added');
    };
    if (this.activeTab() === 'staff') {
      this._closuresService.createStaff(this._salonId, this._staffId, body, onSuccess);
    } else {
      this._closuresService.createSalon(this._salonId, body, onSuccess);
    }
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
        if (this.activeTab() === 'staff') {
          this._closuresService.deleteStaff(this._salonId, this._staffId, closure.id);
        } else {
          this._closuresService.deleteSalon(this._salonId, closure.id);
        }
      });
  }

  protected get activeClosures(): Closure[] {
    return this.activeTab() === 'staff' ? this.staffClosures() : this.salonClosures();
  }
}
