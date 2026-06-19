import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../api/api-configuration';
import { schedulesControllerFindAll } from '../../api/fn/schedules/schedules-controller-find-all';
import { schedulesControllerCreate } from '../../api/fn/schedules/schedules-controller-create';
import { schedulesControllerUpdate } from '../../api/fn/schedules/schedules-controller-update';
import { schedulesControllerDelete } from '../../api/fn/schedules/schedules-controller-delete';
import { StaffSchedule } from '../../api/models/staff-schedule';
import { ConfirmDialogService } from '../../shared/components/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../core/toast/toast.service';
import { filter, switchMap } from 'rxjs';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

@Component({
  selector: 'app-weekly-schedule',
  templateUrl: './weekly-schedule.component.html',
  imports: [ReactiveFormsModule, SkeletonComponent],
})
export class WeeklyScheduleComponent implements OnInit {
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _fb = inject(FormBuilder);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _toast = inject(ToastService);

  protected readonly loading = signal(true);
  protected readonly schedules = signal<StaffSchedule[]>([]);
  protected readonly editingId = signal<string | null>(null);
  protected readonly addingDay = signal<number | null>(null);
  protected readonly saving = signal(false);

  protected readonly days = DAYS;

  protected readonly editForm = this._fb.group({
    startTime: ['', Validators.required],
    endTime: ['', Validators.required],
  });

  protected readonly addForm = this._fb.group({
    startTime: ['09:00', Validators.required],
    endTime: ['18:00', Validators.required],
  });

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  private get _staffId(): string {
    return this._route.snapshot.paramMap.get('staffId') ?? '';
  }

  ngOnInit(): void {
    schedulesControllerFindAll(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
      staffId: this._staffId,
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          this.schedules.set(res.body);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  protected scheduleForDay(day: number): StaffSchedule | undefined {
    return this.schedules().find((s) => s.dayOfWeek === day);
  }

  protected startEdit(schedule: StaffSchedule): void {
    this.editingId.set(schedule.id);
    this.editForm.setValue({ startTime: schedule.startTime, endTime: schedule.endTime });
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
  }

  protected saveEdit(schedule: StaffSchedule): void {
    if (this.editForm.invalid || this.saving()) return;
    this.saving.set(true);
    const { startTime, endTime } = this.editForm.getRawValue();

    schedulesControllerUpdate(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
      staffId: this._staffId,
      scheduleId: schedule.id,
      body: { startTime: startTime!, endTime: endTime! },
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          this.schedules.update((list) => list.map((s) => (s.id === schedule.id ? res.body : s)));
          this.editingId.set(null);
          this.saving.set(false);
        },
        error: () => this.saving.set(false),
      });
  }

  protected startAdd(day: number): void {
    this.addingDay.set(day);
    this.addForm.setValue({ startTime: '09:00', endTime: '18:00' });
  }

  protected cancelAdd(): void {
    this.addingDay.set(null);
  }

  protected saveAdd(day: number): void {
    if (this.addForm.invalid || this.saving()) return;
    this.saving.set(true);
    const { startTime, endTime } = this.addForm.getRawValue();

    schedulesControllerCreate(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
      staffId: this._staffId,
      body: { dayOfWeek: day, startTime: startTime!, endTime: endTime! },
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          this.schedules.update((list) => [...list, res.body]);
          this.addingDay.set(null);
          this.saving.set(false);
        },
        error: () => this.saving.set(false),
      });
  }

  protected deleteSchedule(schedule: StaffSchedule): void {
    this._confirmDialog
      .open({
        title: `Remove ${DAYS[schedule.dayOfWeek]}?`,
        message: 'This working day will be removed from the schedule.',
        confirmLabel: 'Remove',
        danger: true,
      })
      .pipe(
        filter((ok) => ok),
        switchMap(() => {
          this.saving.set(true);
          return schedulesControllerDelete(this._http, this._apiConfig.rootUrl, {
            salonId: this._salonId,
            staffId: this._staffId,
            scheduleId: schedule.id,
          });
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe({
        next: () => {
          this.schedules.update((list) => list.filter((s) => s.id !== schedule.id));
          this.saving.set(false);
        },
        error: () => this.saving.set(false),
      });
  }
}
