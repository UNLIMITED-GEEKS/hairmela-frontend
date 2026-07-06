import { Component, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { QueueEntry } from '../../../api/models/queue-entry';

@Component({
  selector: 'app-my-visits',
  templateUrl: './my-visits.component.html',
  imports: [RouterLink],
})
export class MyVisitsComponent {
  private readonly _router = inject(Router);

  readonly entries = input.required<QueueEntry[]>();

  protected goToPosition(entry: QueueEntry): void {
    const slug = entry.queue?.salon?.slug;
    if (!slug) return;
    this._router.navigate(['/s', slug, 'q', entry.queueId, 'e', entry.id, 'position']);
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
