import { Component, inject, OnInit, computed } from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { QueueEntry } from '../../../api/models/queue-entry';
import { ActiveQueuesService } from './active-queues.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { RoutePath } from '../../../core/routing/route-paths';

const DEFAULT_CANCELLATION_WINDOW_MINUTES = 60;

@Component({
  selector: 'app-auth-queues',
  templateUrl: './auth-queues.component.html',
  imports: [PageHeaderComponent, DatePipe],
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

  // Salon.settings is an untyped blob on the wire (backend doesn't declare
  // its shape in Swagger — same bracket-index-and-cast pattern used by
  // salon-settings.component.ts and salon-visit.service.ts's showPrice).
  private _cancellationWindowMinutes(entry: QueueEntry): number {
    const settings = entry.queue?.salon?.settings as Record<string, unknown> | undefined;
    return (settings?.['cancellationWindow'] as number) ?? DEFAULT_CANCELLATION_WINDOW_MINUTES;
  }

  /** Whether this appointment is still far enough out that cancelling is allowed. */
  protected canCancel(entry: QueueEntry): boolean {
    if (!entry.scheduledAt) return false;
    const windowMs = this._cancellationWindowMinutes(entry) * 60 * 1000;
    return new Date(entry.scheduledAt).getTime() - Date.now() >= windowMs;
  }

  protected cancelAppointment(entry: QueueEntry): void {
    this._service.cancelAppointment(entry);
  }
}
