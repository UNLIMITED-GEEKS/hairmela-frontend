import { Component, computed, inject, input, signal } from '@angular/core';
import { AppPlatformService } from '../../../core/native/app-platform.service';
import { ToastService } from '../../../core/toast/toast.service';
import {
  CalendarEvent,
  googleCalendarUrl,
  icsContent,
  outlookCalendarUrl,
} from '../../../core/calendar/calendar-link';

/**
 * "Add to calendar" for a confirmed appointment.
 *
 * APPOINTMENTS ONLY — a walk-in has no scheduled time, so callers must not
 * render this for one. The `start` input is required precisely so there is no
 * sensible way to use it without one.
 *
 * Google and Outlook.com open a pre-filled URL; everything else (Apple
 * Calendar, Outlook desktop) takes the .ics file. No API, no OAuth, no keys.
 */
@Component({
  selector: 'app-add-to-calendar',
  templateUrl: './add-to-calendar.component.html',
})
export class AddToCalendarComponent {
  readonly title = input.required<string>();
  readonly start = input.required<string>();
  /** Falls back to 30 minutes after start when the surface has no end time. */
  readonly end = input<string | null>(null);
  readonly details = input<string>('');
  readonly location = input<string>('');
  /** Stable per appointment, so re-adding updates rather than duplicates. */
  readonly uid = input.required<string>();

  private readonly _platform = inject(AppPlatformService);
  private readonly _toast = inject(ToastService);

  protected readonly open = signal(false);

  private readonly _event = computed<CalendarEvent | null>(() => {
    const startAt = new Date(this.start());
    if (Number.isNaN(startAt.getTime())) return null;
    const endRaw = this.end();
    const endAt = endRaw ? new Date(endRaw) : new Date(startAt.getTime() + 30 * 60 * 1000);
    return {
      title: this.title(),
      start: startAt,
      end: Number.isNaN(endAt.getTime()) ? new Date(startAt.getTime() + 30 * 60 * 1000) : endAt,
      details: this.details() || undefined,
      location: this.location() || undefined,
    };
  });

  /** Hidden entirely when there is no usable time — never guess one. */
  protected readonly usable = computed(() => this._event() !== null);

  protected readonly googleUrl = computed(() => {
    const e = this._event();
    return e ? googleCalendarUrl(e) : '';
  });

  protected readonly outlookUrl = computed(() => {
    const e = this._event();
    return e ? outlookCalendarUrl(e) : '';
  });

  protected toggle(): void {
    this.open.update((v) => !v);
  }

  /**
   * Downloads the .ics — the Apple Calendar / Outlook desktop path.
   *
   * Inside the installed app a blob download is blocked by the WebView, so
   * this opens the file as a data URI instead, which iOS and Android both
   * hand to the system calendar.
   */
  protected downloadIcs(): void {
    const e = this._event();
    if (!e) return;
    const content = icsContent(e, this.uid());
    this.open.set(false);

    if (this._platform.isAppContext) {
      // Blob URLs and <a download> are inert in the Capacitor WebView; a
      // data: URI is handed to the OS, which opens the calendar importer.
      window.open(`data:text/calendar;charset=utf-8,${encodeURIComponent(content)}`, '_blank');
      return;
    }

    try {
      const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'appointment.ics';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      this._toast.error('Could not create the calendar file.');
    }
  }
}
