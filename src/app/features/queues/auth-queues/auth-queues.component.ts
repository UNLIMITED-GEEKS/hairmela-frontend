import { Component, inject, OnInit, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { QueueEntry } from '../../../api/models/queue-entry';
import { ActiveQueuesService } from './active-queues.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { RescheduleDialogComponent } from '../../visit/reschedule-dialog/reschedule-dialog.component';
import { canReschedule, withinChangeWindow } from '../../../core/appointments/reschedule-policy';
import { RoutePath } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-auth-queues',
  templateUrl: './auth-queues.component.html',
  imports: [PageHeaderComponent, DatePipe, RescheduleDialogComponent],
})
export class AuthQueuesComponent implements OnInit {
  private readonly _router = inject(Router);
  private readonly _service = inject(ActiveQueuesService);

  protected readonly entries = this._service.entries;
  protected readonly loading = this._service.loading;
  protected readonly error = this._service.error;
  protected readonly cancelling = this._service.cancelling;

  protected readonly walkInEntries = computed(() =>
    this.entries().filter((e) => e.type === 'WALK_IN'),
  );
  protected readonly appointmentEntries = computed(() =>
    this.entries().filter((e) => e.type === 'APPOINTMENT'),
  );

  /** The appointment being rescheduled, or null when the dialog is closed. */
  protected readonly rescheduleEntry = signal<QueueEntry | null>(null);

  ngOnInit(): void {
    this._service.load();
  }

  protected retry(): void {
    this._service.refresh();
  }

  protected goToPosition(entry: QueueEntry): void {
    const slug = entry.queue?.salon?.slug;
    if (!slug) return;
    this._router.navigate(RoutePath.visitPosition('', slug, entry.queueId, entry.id));
  }

  protected salonName(entry: QueueEntry): string {
    return entry.queue?.salon?.name ?? '';
  }

  protected leaderName(entry: QueueEntry): string {
    return entry.members.find((m) => m.isLeader)?.memberName ?? 'You';
  }

  protected partyCount(entry: QueueEntry): number {
    return entry.members.length;
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
