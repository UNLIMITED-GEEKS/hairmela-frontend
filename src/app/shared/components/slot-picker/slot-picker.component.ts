import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SalonVisitService } from '../../../features/visit/salon-visit.service';
import { AvailableSlotDto } from '../../../api/models/available-slot-dto';
import { MiniMonthCalendarComponent } from '../mini-month-calendar/mini-month-calendar.component';
import { toIsoDate, startOfMonth, monthRange, formatSlotTime } from './iso-date';

/**
 * "Pick a bookable slot" — month calendar + availability + time grid, as one
 * unit. Owns the whole concept: which month is visible, that month's slots,
 * and which day/time are chosen.
 *
 * Extracted from BookAppointmentDialogComponent so booking and rescheduling
 * share one implementation rather than two drifting copies. Availability is
 * live bookable-slot data, so it is never cached across opens; it IS fetched a
 * whole month at a time (not per-day) purely to keep the request count down.
 *
 * The selected date/time are `model()`s: the parent owns the values and reacts
 * to them (that's what it submits), while this component owns how they're
 * chosen. Everything else — what a slot MEANS, which endpoint it's for — stays
 * with the parent.
 */
@Component({
  selector: 'app-slot-picker',
  templateUrl: './slot-picker.component.html',
  imports: [MiniMonthCalendarComponent],
})
export class SlotPickerComponent {
  readonly salonId = input.required<string>();
  /** Whose availability to show. Null pauses fetching (no staff chosen yet). */
  readonly staffId = input.required<string | null>();
  /**
   * Bumped by the parent to reset this picker to a clean state — a dialog
   * reopening, or a different staff member being chosen. A counter rather than
   * a boolean so repeated resets always register as a change.
   */
  readonly resetToken = input(0);
  /** Earliest selectable day. Defaults to today; rescheduling keeps that. */
  readonly minDate = input(toIsoDate(new Date()));

  readonly selectedDate = model<string | null>(null);
  readonly selectedStartTime = model<string | null>(null);

  private readonly _visit = inject(SalonVisitService);
  private readonly _destroyRef = inject(DestroyRef);

  protected readonly viewedMonth = signal(startOfMonth(new Date()));
  protected readonly monthSlots = signal<AvailableSlotDto[]>([]);
  protected readonly slotsLoading = signal(false);

  // Distinguishes "this component was just constructed" from "the parent asked
  // for a reset" — see the effect in the constructor.
  private _firstRun = true;

  /** Days in the visible month with at least one bookable slot — calendar dots. */
  protected readonly badgeFor = computed(() => {
    const days = new Set(
      this.monthSlots()
        .map((s) => s.date)
        .filter((d): d is string => !!d),
    );
    return (iso: string) => (days.has(iso) ? 1 : 0);
  });

  protected readonly selectedDaySlots = computed<AvailableSlotDto[]>(() => {
    const day = this.selectedDate();
    return day ? this.monthSlots().filter((s) => s.date === day) : [];
  });

  constructor() {
    // Reset + refetch whenever the parent bumps the token or swaps staff.
    //
    // untracked() wraps the body because _fetchMonth() reads viewedMonth()
    // internally, and an effect tracks every signal read during its run —
    // including reads inside functions it calls. Without it, onMonthChange()'s
    // write to viewedMonth would retrigger this effect and immediately snap the
    // calendar back to the current month. (This exact bug bit the original
    // single-date input in the booking dialog; keeping the guard here is what
    // lets the extraction preserve the fix.)
    effect(() => {
      const token = this.resetToken();
      const staffId = this.staffId();
      untracked(() => {
        // First run with a date the parent already holds = this component was
        // just RECREATED around an existing choice, not asked to start over.
        //
        // The booking dialog's fee step is an @if sibling, so stepping forward
        // DESTROYS this picker and stepping Back builds a new one. Resetting
        // here wiped the slot the customer had already chosen — they pressed
        // Back and their time was gone. The parent's date/time survive that
        // destruction (they are its own signals), so honour them and just
        // refetch the month they belong to.
        const isRecreatedWithSelection = this._firstRun && !!this.selectedDate();
        this._firstRun = false;

        if (isRecreatedWithSelection) {
          this.viewedMonth.set(startOfMonth(new Date(this.selectedDate()!)));
          this.monthSlots.set([]);
          this._fetchMonth();
          return;
        }

        // A genuine reset: the dialog reopened, or a different staff member
        // was picked, so any previous choice is meaningless.
        void token;
        void staffId;
        this.viewedMonth.set(startOfMonth(new Date()));
        // Auto-select the earliest allowed day so the Time section is visible
        // immediately, rather than only after a manual tap.
        this.selectedDate.set(this.minDate());
        this.selectedStartTime.set(null);
        this.monthSlots.set([]);
        this._fetchMonth();
      });
    });
  }

  protected onMonthChange(month: Date): void {
    this.viewedMonth.set(month);
    // Auto-select the 1st of the newly-visible month so Time stays visible
    // without an extra tap after navigating.
    this.selectedDate.set(toIsoDate(new Date(month.getFullYear(), month.getMonth(), 1)));
    this.selectedStartTime.set(null);
    this._fetchMonth();
  }

  protected onDaySelect(iso: string): void {
    // No toggle-off — a day is always selected while this is open, so the Time
    // section never disappears; re-tapping the same day is a no-op.
    this.selectedDate.set(iso);
    this.selectedStartTime.set(null);
  }

  /** "14:00" -> "2pm" for display; the raw value is what gets submitted. */
  protected readonly formatTime = formatSlotTime;

  protected selectSlot(slot: AvailableSlotDto): void {
    this.selectedStartTime.set(slot.startTime);
  }

  private _fetchMonth(): void {
    const staffId = this.staffId();
    if (!staffId) return;
    const { from, to } = monthRange(this.viewedMonth());
    this.slotsLoading.set(true);
    this.monthSlots.set([]);
    this._visit
      .getAvailabilityRange(this.salonId(), staffId, from, to)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (slots) => {
          this.monthSlots.set(slots);
          this.slotsLoading.set(false);
        },
        error: () => this.slotsLoading.set(false),
      });
  }
}
