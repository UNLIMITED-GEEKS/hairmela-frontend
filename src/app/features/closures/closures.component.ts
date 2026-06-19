import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, switchMap } from 'rxjs';
import { ApiConfiguration } from '../../api/api-configuration';
import { salonClosuresControllerFindAll } from '../../api/fn/schedules/salon-closures-controller-find-all';
import { salonClosuresControllerCreate } from '../../api/fn/schedules/salon-closures-controller-create';
import { salonClosuresControllerDelete } from '../../api/fn/schedules/salon-closures-controller-delete';
import { staffClosuresControllerFindAll } from '../../api/fn/schedules/staff-closures-controller-find-all';
import { staffClosuresControllerCreate } from '../../api/fn/schedules/staff-closures-controller-create';
import { staffClosuresControllerDelete } from '../../api/fn/schedules/staff-closures-controller-delete';
import { Closure } from '../../api/models/closure';
import { ConfirmDialogService } from '../../shared/components/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../core/toast/toast.service';

type ClosureScope = 'salon' | 'staff';

@Component({
  selector: 'app-closures',
  templateUrl: './closures.component.html',
  imports: [ReactiveFormsModule, SkeletonComponent],
})
export class ClosuresComponent implements OnInit {
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _fb = inject(FormBuilder);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _toast = inject(ToastService);

  protected readonly loading = signal(true);
  protected readonly salonClosures = signal<Closure[]>([]);
  protected readonly staffClosures = signal<Closure[]>([]);
  protected readonly activeTab = signal<ClosureScope>('salon');
  protected readonly showAddForm = signal(false);
  protected readonly saving = signal(false);

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
    this._loadSalon();
    if (this._staffId) this._loadStaff();
  }

  private _loadSalon(): void {
    salonClosuresControllerFindAll(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          this.salonClosures.set(res.body);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  private _loadStaff(): void {
    staffClosuresControllerFindAll(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
      staffId: this._staffId,
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => this.staffClosures.set(res.body),
      });
  }

  protected setTab(tab: ClosureScope): void {
    this.activeTab.set(tab);
    this.showAddForm.set(false);
  }

  protected add(): void {
    if (this.addForm.invalid || this.saving()) return;
    this.saving.set(true);
    const { date, reason } = this.addForm.getRawValue();

    const call$ =
      this.activeTab() === 'staff'
        ? staffClosuresControllerCreate(this._http, this._apiConfig.rootUrl, {
            salonId: this._salonId,
            staffId: this._staffId,
            body: { date: date!, reason: reason || undefined },
          })
        : salonClosuresControllerCreate(this._http, this._apiConfig.rootUrl, {
            salonId: this._salonId,
            body: { date: date!, reason: reason || undefined },
          });

    call$.pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: (res) => {
        if (this.activeTab() === 'staff') {
          this.staffClosures.update((list) =>
            [...list, res.body].sort((a, b) => a.date.localeCompare(b.date)),
          );
        } else {
          this.salonClosures.update((list) =>
            [...list, res.body].sort((a, b) => a.date.localeCompare(b.date)),
          );
        }
        this.saving.set(false);
        this.showAddForm.set(false);
        this.addForm.reset();
        this._toast.success('Closure added');
      },
      error: () => this.saving.set(false),
    });
  }

  protected delete(closure: Closure): void {
    this._confirmDialog
      .open({
        title: `Remove closure on ${closure.date}?`,
        message: closure.reason ? `Reason: ${closure.reason}` : 'This closure will be removed.',
        confirmLabel: 'Remove',
        danger: true,
      })
      .pipe(
        filter((ok) => ok),
        switchMap(() => {
          this.saving.set(true);
          return this.activeTab() === 'staff'
            ? staffClosuresControllerDelete(this._http, this._apiConfig.rootUrl, {
                salonId: this._salonId,
                staffId: this._staffId,
                closureId: closure.id,
              })
            : salonClosuresControllerDelete(this._http, this._apiConfig.rootUrl, {
                salonId: this._salonId,
                closureId: closure.id,
              });
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe({
        next: () => {
          if (this.activeTab() === 'staff') {
            this.staffClosures.update((list) => list.filter((c) => c.id !== closure.id));
          } else {
            this.salonClosures.update((list) => list.filter((c) => c.id !== closure.id));
          }
          this.saving.set(false);
        },
        error: () => this.saving.set(false),
      });
  }

  protected get activeClosures(): Closure[] {
    return this.activeTab() === 'staff' ? this.staffClosures() : this.salonClosures();
  }
}
