import { Component, input, output, computed } from '@angular/core';

export interface MonthDayCell {
  readonly date: Date;
  readonly iso: string;
  readonly inCurrentMonth: boolean;
  readonly isToday: boolean;
  readonly disabled: boolean;
  readonly badge: number;
}

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Purely presentational month grid — no fetching, no knowledge of what a
// "badge" count means (appointment count on the barber-facing calendar,
// unused/omitted on the booking modals' date picker). Consumers own their
// own data and pass a badgeFor() lookup; this component only owns the
// month/day-cell math (leading/trailing blanks, real days-in-month via
// native Date so Feb/30-day months are handled with no manual table) and
// the click/nav wiring. Extracted from AppointmentsListComponent so the
// same grid isn't hand-duplicated across the barber calendar and the
// customer/staff booking modals.
@Component({
  selector: 'app-mini-month-calendar',
  templateUrl: './mini-month-calendar.component.html',
})
export class MiniMonthCalendarComponent {
  readonly viewedMonth = input.required<Date>();
  readonly selectedDate = input<string | null>(null);
  /** Days before this ISO date render disabled (unclickable) — e.g. "no past dates". */
  readonly minDate = input<string | null>(null);
  /** Per-day badge count (e.g. appointment count); 0/omitted renders no dot. */
  readonly badgeFor = input<(iso: string) => number>(() => 0);

  readonly monthChange = output<Date>();
  readonly daySelect = output<string>();

  protected readonly monthLabel = computed(() =>
    this.viewedMonth().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  );

  protected readonly weeks = computed<MonthDayCell[][]>(() => {
    const month = this.viewedMonth();
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const firstOfMonth = new Date(year, monthIndex, 1);
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const leadingBlanks = firstOfMonth.getDay(); // 0 = Sunday
    const totalCells = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;

    const today = toIsoDate(new Date());
    const min = this.minDate();
    const badgeFor = this.badgeFor();

    const cells: MonthDayCell[] = [];
    for (let i = 0; i < totalCells; i++) {
      const dayOffset = i - leadingBlanks + 1;
      const date = new Date(year, monthIndex, dayOffset);
      const iso = toIsoDate(date);
      cells.push({
        date,
        iso,
        inCurrentMonth: date.getMonth() === monthIndex,
        isToday: iso === today,
        disabled: min !== null && iso < min,
        badge: badgeFor(iso),
      });
    }

    const weeks: MonthDayCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }
    return weeks;
  });

  protected prevMonth(): void {
    const m = this.viewedMonth();
    this.monthChange.emit(new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }

  protected nextMonth(): void {
    const m = this.viewedMonth();
    this.monthChange.emit(new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }

  protected selectDay(cell: MonthDayCell): void {
    if (cell.disabled) return;
    this.daySelect.emit(cell.iso);
  }
}
