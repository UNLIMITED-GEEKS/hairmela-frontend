import { Component, inject, OnInit, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { QueueEntry } from '../../../api/models/queue-entry';
import { ActiveQueuesService } from './active-queues.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { RescheduleDialogComponent } from '../../visit/reschedule-dialog/reschedule-dialog.component';
import { AddToCalendarComponent } from '../../../shared/components/add-to-calendar/add-to-calendar.component';
import { canReschedule, withinChangeWindow } from '../../../core/appointments/reschedule-policy';
import { RoutePath } from '../../../core/routing/route-paths';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import {
  countVisitHistory,
  filterVisitHistory,
  VisitHistoryTab,
  VISIT_HISTORY_TABS,
} from '../visit-history-tabs';

@Component({
  selector: 'app-auth-queues',
  templateUrl: './auth-queues.component.html',
  imports: [
    PageHeaderComponent,
    DatePipe,
    RescheduleDialogComponent,
    AddToCalendarComponent,
    SkeletonComponent,
  ],
})
export class AuthQueuesComponent implements OnInit {
  private readonly _router = inject(Router);
  private readonly _service = inject(ActiveQueuesService);

  protected readonly entries = this._service.entries;
  protected readonly loading = this._service.loading;
  protected readonly error = this._service.error;
  protected readonly cancelling = this._service.cancelling;

  protected readonly historyTabs = VISIT_HISTORY_TABS;
  protected readonly selectedTab = signal<VisitHistoryTab>('upcoming');
  protected readonly tabCounts = computed(() => countVisitHistory(this.entries()));
  protected readonly filteredEntries = computed(() =>
    filterVisitHistory(this.entries(), this.selectedTab()),
  );
  protected readonly walkInEntries = computed(() =>
    this.filteredEntries().filter((e) => e.type === 'WALK_IN'),
  );
  protected readonly appointmentEntries = computed(() =>
    this.filteredEntries().filter((e) => e.type === 'APPOINTMENT'),
  );

  protected selectTab(tab: VisitHistoryTab): void {
    this.selectedTab.set(tab);
  }

  /** The appointment being rescheduled, or null when the dialog is closed. */
  protected readonly rescheduleEntry = signal<QueueEntry | null>(null);

  ngOnInit(): void {
    this._service.load();
  }

  protected retry(): void {
    this._service.refresh();
  }

  protected canOpenEntry(entry: QueueEntry): boolean {
    return entry.status === 'WAITING' || entry.status === 'SERVING';
  }

  protected goToPosition(entry: QueueEntry): void {
    if (!this.canOpenEntry(entry)) return;
    const slug = entry.queue?.salon?.slug;
    if (!slug) return;
    this._router.navigate(RoutePath.visitPosition('', slug, entry.queueId, entry.id));
  }

  /** Street/city for the calendar event's location field. */
  protected salonAddress(entry: QueueEntry): string {
    const a = entry.queue?.salon?.address;
    if (!a) return '';
    return [a.street, a.city, a.state].filter(Boolean).join(', ');
  }

  protected salonName(entry: QueueEntry): string {
    return entry.queue?.salon?.name ?? '';
  }

  protected staffName(entry: QueueEntry): string {
    const staff = entry.staff;
    return staff?.user ? `${staff.user.firstName} ${staff.user.lastName}` : (staff?.email ?? '');
  }

  protected serviceNames(entry: QueueEntry): string {
    return entry.members
      .map((m) => m.service?.name)
      .filter((name): name is string => !!name)
      .join(', ');
  }

  /** Whether this appointment is still far enough out that cancelling is allowed. */
  protected canCancel(entry: QueueEntry): boolean {
    return withinChangeWindow(entry);
  }

  protected canReschedule(entry: QueueEntry): boolean {
    return canReschedule(entry);
  }

  protected openReschedule(entry: QueueEntry): void {
    this.rescheduleEntry.set(entry);
  }

  protected onRescheduled(): void {
    // The moved appointment has a new scheduledAt (and rescheduledAt), so this
    // list is stale — refetch rather than patching the row by hand.
    this._service.refresh();
  }

  protected cancelAppointment(entry: QueueEntry): void {
    this._service.cancelAppointment(entry);
  }
}
