import { Component, computed, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QueueEntry } from '../../../api/models/queue-entry';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { RoutePath } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-join-banner',
  templateUrl: './join-banner.component.html',
  imports: [RouterLink, IconComponent],
})
export class JoinBannerComponent {
  readonly entries = input<QueueEntry[]>([]);
  readonly searchLink = input.required<string[]>();
  readonly scanQrCode = output<void>();

  // One card per queue, not per entry — a caller can hold several entries in
  // the same queue (e.g. added a kid as a separate entry while waiting), and
  // since this banner no longer shows per-entry position, those should
  // collapse into a single card rather than showing duplicates for the same
  // queue. A caller CAN be in more than one queue at the same salon (two
  // different barbers), so grouping is by queueId, not salonId.
  protected readonly queueGroups = computed<QueueEntry[]>(() => {
    const byQueue = new Map<string, QueueEntry>();
    for (const entry of this.entries()) {
      if (!byQueue.has(entry.queueId)) byQueue.set(entry.queueId, entry);
    }
    return [...byQueue.values()];
  });

  protected readonly activeIndex = signal(0);

  // Pointer-based swipe (no gesture library — same technique as
  // gallery-modal.component.ts) to move between active-entry cards.
  private _swipeStartX = 0;
  private readonly _swipeThresholdPx = 40;

  protected onPointerDown(event: PointerEvent): void {
    this._swipeStartX = event.clientX;
  }

  protected onPointerUp(event: PointerEvent): void {
    const delta = event.clientX - this._swipeStartX;
    if (Math.abs(delta) < this._swipeThresholdPx) return;
    if (delta < 0) this.next();
    else this.prev();
  }

  protected readonly activeEntry = computed<QueueEntry | null>(
    () => this.queueGroups()[this.activeIndex()] ?? null,
  );

  protected readonly hasPrev = computed(() => this.activeIndex() > 0);
  protected readonly hasNext = computed(() => this.activeIndex() < this.queueGroups().length - 1);

  // No position/wait number here — this banner isn't live, so showing a
  // number that goes stale the moment the user stops looking would be
  // actively misleading. "View Queue" is the one true source of live
  // position (SalonVisitService.watchQueue() on the live-queue page).
  protected readonly queueLink = computed(() => {
    const entry = this.activeEntry();
    if (!entry) return null;
    return RoutePath.visitQueue('', entry.queue.salon.slug, entry.queueId);
  });

  protected prev(): void {
    if (this.hasPrev()) this.activeIndex.update((i) => i - 1);
  }

  protected next(): void {
    if (this.hasNext()) this.activeIndex.update((i) => i + 1);
  }

  protected jumpTo(index: number): void {
    this.activeIndex.set(index);
  }
}
