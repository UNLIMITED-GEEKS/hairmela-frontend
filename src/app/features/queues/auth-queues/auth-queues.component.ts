import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { QueueEntry } from '../../../api/models/queue-entry';
import { ActiveQueuesService } from './active-queues.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { RoutePath } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-auth-queues',
  templateUrl: './auth-queues.component.html',
  imports: [PageHeaderComponent],
})
export class AuthQueuesComponent implements OnInit {
  private readonly _router = inject(Router);
  private readonly _service = inject(ActiveQueuesService);

  protected readonly entries = this._service.entries;
  protected readonly loading = this._service.loading;
  protected readonly error = this._service.error;

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
}
