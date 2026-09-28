import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { QueueEntry } from '../../../api/models/queue-entry';
import { GuestQueuesService } from './guest-queues.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { RoutePath } from '../../../core/routing/route-paths';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { AddToCalendarComponent } from '../../../shared/components/add-to-calendar/add-to-calendar.component';
import { RescheduleDialogComponent } from '../../visit/reschedule-dialog/reschedule-dialog.component';
import { canReschedule, withinChangeWindow } from '../../../core/appointments/reschedule-policy';
import {
  countVisitHistory,
  filterVisitHistory,
  VisitHistoryTab,
  VISIT_HISTORY_TABS,
} from '../visit-history-tabs';

@Component({
  selector: 'app-guest-queues',
  templateUrl: './guest-queues.component.html',
  imports: [
    RouterLink,
    PageHeaderComponent,
    SkeletonComponent,
    DatePipe,
    AddToCalendarComponent,
    RescheduleDialogComponent,
  ],
})
export class GuestQueuesComponent implements OnInit {
  private readonly _router = inject(Router);
  private readonly _service = inject(GuestQueuesService);

  protected readonly entries = this._service.entries;
  protected readonly loading = this._service.loading;
  protected readonly error = this._service.error;
  protected readonly cancelling = this._service.cancelling;
  protected readonly registerUrl = RoutePath.register();

  protected readonly historyTabs = VISIT_HISTORY_TABS;
  protected readonly selectedTab = signal<VisitHistoryTab>('upcoming');
  protected readonly tabCounts = computed(() => countVisitHistory(this.entries()));
  protected readonly filteredEntries = computed(() =>
    filterVisitHistory(this.entries(), this.selectedTab()),
  );
  protected readonly walkInEntries = computed(() =>
    this.filteredEntries().filter((entry) => entry.type === 'WALK_IN'),
  );
  protected readonly appointmentEntries = computed(() =>
    this.filteredEntries().filter((entry) => entry.type === 'APPOINTMENT'),
  );

  protected selectTab(tab: VisitHistoryTab): void {
    this.selectedTab.set(tab);
  }
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
    this._router.navigate(RoutePath.visitPosition('/g', slug, entry.queueId, entry.id));
  }

  protected salonName(entry: QueueEntry): string {
    return entry.queue?.salon?.name ?? '';
  }

  protected staffName(entry: QueueEntry): string {
    const staff = entry.staff as unknown as {
      name?: string;
      email?: string;
      user?: { firstName?: string; lastName?: string } | null;
    };
    if (staff.name) return staff.name;
    if (staff.user) return [staff.user.firstName, staff.user.lastName].filter(Boolean).join(' ');
    return staff.email ?? '';
  }

  protected serviceNames(entry: QueueEntry): string {
    return entry.members
      .map((member) => member.service?.name)
      .filter((name): name is string => !!name)
      .join(', ');
  }

  protected salonAddress(entry: QueueEntry): string {
    const address = entry.queue?.salon?.address;
    if (!address) return '';
    return [address.street, address.city, address.state].filter(Boolean).join(', ');
  }

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
    this._service.refresh();
  }

  protected cancelAppointment(entry: QueueEntry): void {
    this._service.cancelAppointment(entry);
  }
}
