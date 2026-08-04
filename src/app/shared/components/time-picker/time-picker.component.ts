import { Component, computed, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

// 12-hour time picker over a 24-hour "HH:mm" value.
//
// Replaces <input type="time">, whose DISPLAY format follows the OS/browser
// locale and cannot be overridden from the page. On a 24-hour locale that
// input accepts a bare "7" as 07:00 with no AM/PM affordance at all, so an
// owner meaning 7:30 PM silently sets 07:00 — the bug this component exists
// to remove. Hour/minute/period are three explicit selects, so there is no
// format to misread and no way to submit an hour without stating AM or PM.
//
// The control's value stays "HH:mm" (24-hour) in both directions — every
// existing form group, DTO, and backend contract is untouched.
const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1);
// 5-minute granularity: salon opening hours and staff shifts are set on the
// quarter/half hour in practice, and a 60-entry minute list is far worse to
// scroll on a phone than it is precise.
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

@Component({
  selector: 'app-time-picker',
  templateUrl: './time-picker.component.html',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TimePickerComponent),
      multi: true,
    },
  ],
})
export class TimePickerComponent implements ControlValueAccessor {
  readonly ariaLabel = input('Time');

  protected readonly hours = HOURS_12;
  protected readonly minutes = MINUTES;

  // Parsed 12-hour parts of the current 24-hour value.
  protected readonly hour12 = signal(9);
  protected readonly minute = signal(0);
  protected readonly period = signal<'AM' | 'PM'>('AM');
  protected readonly disabled = signal(false);

  protected readonly minuteLabel = computed(() => String(this.minute()).padStart(2, '0'));

  private _onChange: (value: string) => void = () => {};
  private _onTouched: () => void = () => {};

  writeValue(value: string | null): void {
    // Anything unparseable (null on a fresh control, a malformed string)
    // falls back to 9:00 AM rather than rendering a blank/NaN select.
    const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? '');
    const hour24 = match ? Number(match[1]) : 9;
    const minute = match ? Number(match[2]) : 0;

    this.period.set(hour24 >= 12 ? 'PM' : 'AM');
    this.hour12.set(hour24 % 12 === 0 ? 12 : hour24 % 12);
    // Snap to the nearest option we actually offer, so a value set elsewhere
    // (e.g. an existing salon's 09:37) still selects rather than showing blank.
    const snapped = MINUTES.reduce((a, b) =>
      Math.abs(b - minute) < Math.abs(a - minute) ? b : a,
    );
    this.minute.set(snapped);

    // If snapping (or the unparseable fallback) changed the value, push the
    // correction back to the control. Without this the UI would show 09:35
    // while the form still held 09:37 — a silent mismatch that submits the
    // value the user never saw.
    const normalized = this._format();
    if (normalized !== value) {
      // Defer: writeValue runs during the control's own value-setting pass,
      // and emitting synchronously into it triggers ExpressionChanged /
      // re-entrant update warnings.
      queueMicrotask(() => this._onChange(normalized));
    }
  }

  registerOnChange(fn: (value: string) => void): void {
    this._onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this._onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  protected onHourChange(value: string): void {
    this.hour12.set(Number(value));
    this._emit();
  }

  protected onMinuteChange(value: string): void {
    this.minute.set(Number(value));
    this._emit();
  }

  protected onPeriodChange(value: string): void {
    this.period.set(value === 'PM' ? 'PM' : 'AM');
    this._emit();
  }

  protected onBlur(): void {
    this._onTouched();
  }

  /** Current hour/minute/period as the 24-hour "HH:mm" the control stores. */
  private _format(): string {
    const h = this.hour12() % 12; // 12 AM -> 0, 12 PM -> 12 (via the +12 below)
    const hour24 = this.period() === 'PM' ? h + 12 : h;
    return `${String(hour24).padStart(2, '0')}:${this.minuteLabel()}`;
  }

  private _emit(): void {
    this._onChange(this._format());
  }
}
