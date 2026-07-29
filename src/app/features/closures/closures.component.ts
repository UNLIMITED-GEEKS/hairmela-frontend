import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
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
import { TabsComponent, TabItem } from '../../shared/components/tabs/tabs.component';
import { AnimatedListComponent } from '../../shared/components/animated-list/animated-list.component';
import { filter } from 'rxjs';
import { RouteParam } from '../../core/routing/route-paths';

type ClosureScope = 'salon' | 'staff';

const SCOPE_TABS: TabItem[] = [
  { id: 'salon', label: 'Salon' },
  { id: 'staff', label: 'This staff' },
];

@Component({
  selector: 'app-closures',
  templateUrl: './closures.component.html',
  imports: [
    ReactiveFormsModule,
    SkeletonComponent,
    FrozenBannerComponent,
    TierFreezeDirective,
    FieldErrorComponent,
    TabsComponent,
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

  protected readonly scopeTabs = SCOPE_TABS;
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
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  protected get _staffId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.STAFF_ID) ?? '';
  }

  ngOnInit(): void {
    this._closuresService.loadSalon(this._salonId);
    if (this._staffId) this._closuresService.loadStaff(this._salonId, this._staffId);
  }

  protected retry(): void {
    this._closuresService.refreshSalon(this._salonId);
    if (this._staffId) this._closuresService.refreshStaff(this._salonId, this._staffId);
  }

  protected setTab(tab: string): void {
    this.activeTab.set(tab as ClosureScope);
    this.showAddForm.set(false);
  }

  protected add(): void {
    if (this.addForm.invalid) return;
    const { date, reason } = this.addForm.getRawValue();
    const body = { date: date!, reason: reason || undefined };
    if (this.activeTab() === 'staff') {
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
