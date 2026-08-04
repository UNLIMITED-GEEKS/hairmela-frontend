import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import {
  AbstractControlOptions,
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { filter } from 'rxjs';
import { StaffSchedule } from '../../api/models/staff-schedule';
import { ConfirmDialogService } from '../../shared/components/confirm-dialog/confirm-dialog.service';
import { SchedulesService } from './schedules.service';
import { FieldErrorComponent } from '../../shared/components/field-error/field-error.component';
import { TimePickerComponent } from '../../shared/components/time-picker/time-picker.component';
import { RouteParam } from '../../core/routing/route-paths';
import { endAfterStart } from '../../core/utils/time-range.validator';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

@Component({
  selector: 'app-weekly-schedule',
  templateUrl: './weekly-schedule.component.html',
  imports: [
    ReactiveFormsModule,
    SkeletonComponent,
    FieldErrorComponent,
    PageHeaderComponent,
    TimePickerComponent,
  ],
})
export class WeeklyScheduleComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _fb = inject(FormBuilder);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _schedulesService = inject(SchedulesService);

  protected readonly loading = this._schedulesService.loading;
  protected readonly error = this._schedulesService.error;
  protected readonly schedules = this._schedulesService.schedules;

  protected readonly editingId = signal<string | null>(null);
  protected readonly addingDay = signal<number | null>(null);

  protected readonly days = DAYS;

  protected readonly editForm = this._fb.group(
    {
      startTime: ['', Validators.required],
      endTime: ['', Validators.required],
    },
    { validators: endAfterStart } as AbstractControlOptions,
  );

  protected readonly addForm = this._fb.group(
    {
      startTime: ['09:00', Validators.required],
      endTime: ['18:00', Validators.required],
    },
    { validators: endAfterStart } as AbstractControlOptions,
  );

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  private get _staffId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.STAFF_ID) ?? '';
  }

  ngOnInit(): void {
    this._schedulesService.load(this._salonId, this._staffId);
  }

  protected retry(): void {
    this._schedulesService.refresh(this._salonId, this._staffId);
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
    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }
    const { startTime, endTime } = this.editForm.getRawValue();
    this._schedulesService.update(this._salonId, this._staffId, schedule.id, {
      startTime: startTime!,
      endTime: endTime!,
    });
    // Optimistic: the row already updated, so collapse the form now rather
    // than waiting on the network round-trip.
    this.editingId.set(null);
  }

  protected startAdd(day: number): void {
    this.addingDay.set(day);
    this.addForm.setValue({ startTime: '09:00', endTime: '18:00' });
  }

  protected cancelAdd(): void {
    this.addingDay.set(null);
  }

  protected saveAdd(day: number): void {
    if (this.addForm.invalid) {
      this.addForm.markAllAsTouched();
      return;
    }
    const { startTime, endTime } = this.addForm.getRawValue();
    this._schedulesService.create(this._salonId, this._staffId, {
      dayOfWeek: day,
      startTime: startTime!,
      endTime: endTime!,
    });
    // Optimistic: the row already painted, so collapse the form now rather
    // than waiting on the network round-trip.
    this.addingDay.set(null);
    this.addForm.reset();
  }

  protected deleteSchedule(schedule: StaffSchedule): void {
    this._confirmDialog
      .open({
        title: `Remove ${DAYS[schedule.dayOfWeek]}?`,
        message: 'This working day will be removed from the schedule.',
        confirmLabel: 'Remove',
        danger: true,
      })
      .pipe(filter((ok) => ok))
      .subscribe(() => {
        this._schedulesService.remove(this._salonId, this._staffId, schedule.id);
      });
  }
}
