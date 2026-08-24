import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../api/api-configuration';
import { bookingControllerRescheduleAppointment } from '../../api/fn/queues/booking-controller-reschedule-appointment';
import { staffBookingControllerStaffRescheduleAppointment } from '../../api/fn/queues/staff-booking-controller-staff-reschedule-appointment';
import { QueueEntry } from '../../api/models/queue-entry';
import { RescheduleAppointmentDto } from '../../api/models/reschedule-appointment-dto';
import { ErrorCodes } from '../errors/error-codes';
import { isApiError } from '../errors/api-error.types';
import { ToastService } from '../toast/toast.service';

/** Who is moving the appointment — this picks the endpoint. */
export type RescheduleActor = 'customer' | 'staff';

export interface RescheduleTarget {
  readonly salonId: string;
  readonly queueId: string;
  readonly entryId: string;
}

/**
 * Moves an appointment to a new slot.
 *
 * Two endpoints, one body: customers may only move their OWN booking, staff
 * may move any in their salon. The only difference at this layer is which URL
 * is called, so callers pass an actor rather than reaching for the generated
 * function themselves — that keeps the "which endpoint am I allowed to use"
 * decision in one place instead of at four call sites.
 *
 * Failures are toasted here, because every surface wants the same wording for
 * the same code; callers get an onSuccess for their own follow-up (refetch,
 * close the dialog). See reschedule-policy.ts for the pre-flight rules that
 * keep the button hidden when these errors are predictable.
 */
@Injectable({ providedIn: 'root' })
export class RescheduleService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _toast = inject(ToastService);

  private readonly _saving = signal(false);
  readonly saving = this._saving.asReadonly();

  reschedule(
    actor: RescheduleActor,
    target: RescheduleTarget,
    body: RescheduleAppointmentDto,
    destroyRef: DestroyRef,
    onSuccess: (entry: QueueEntry) => void,
  ): void {
    if (this._saving()) return;
    this._saving.set(true);

    const params = { ...target, body };
    const request$ =
      actor === 'staff'
        ? staffBookingControllerStaffRescheduleAppointment(this._http, this._apiConfig.rootUrl, params)
        : bookingControllerRescheduleAppointment(this._http, this._apiConfig.rootUrl, params);

    request$.pipe(takeUntilDestroyed(destroyRef)).subscribe({
      next: (res) => {
        this._saving.set(false);
        this._toast.success('Appointment rescheduled.');
        onSuccess(res.body);
      },
      error: (err: unknown) => {
        this._saving.set(false);
        this._toast.error(this._messageFor(err));
      },
    });
  }

  // An appointment can be rescheduled once, and only outside the salon's
  // cancellation window — both are checked before the button is even shown
  // (reschedule-policy.ts). Reaching one of those errors anyway means the
  // state changed underneath this view, so the message says what happened
  // rather than blaming the click.
  private _messageFor(err: unknown): string {
    const body = (err as { error?: unknown })?.error;
    if (!isApiError(body)) return 'Could not reschedule this appointment.';
    switch (body.code) {
      case ErrorCodes.ALREADY_RESCHEDULED:
        return 'This appointment has already been rescheduled once.';
      case ErrorCodes.CANCELLATION_WINDOW_PASSED:
        return 'It is too late to change this appointment.';
      case ErrorCodes.SLOT_ALREADY_BOOKED:
      case ErrorCodes.SLOT_NOT_AVAILABLE:
        return 'That time was just taken — pick another slot.';
      case ErrorCodes.SLOT_IN_PAST:
        return 'That time has already passed.';
      default:
        return 'Could not reschedule this appointment.';
    }
  }
}
