import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SalonVisitService } from '../salon-visit.service';
import { JoinDialogComponent } from '../join-dialog/join-dialog.component';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { GalleryModalComponent } from '../../../shared/components/gallery-modal/gallery-modal.component';
import { RouteParam, RoutePath, RouteQueryParam } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-live-queue',
  templateUrl: './live-queue.component.html',
  imports: [RouterLink, JoinDialogComponent, AvatarComponent, GalleryModalComponent],
})
export class LiveQueueComponent implements OnInit {
  protected readonly visit = inject(SalonVisitService);
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);

  protected get _queueId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.QUEUE_ID) ?? '';
  }

  protected get _slug(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SLUG) ?? '';
  }

  protected get _shellPrefix(): string {
    return this._route.snapshot.data['shellPrefix'] ?? '';
  }

  // Carried from the Services tab's barber-drilldown (?serviceId=...) so the
  // join dialog can pre-fill it; absent when arriving via the Staffs tab.
  protected get _serviceId(): string | null {
    return this._route.snapshot.queryParamMap.get(RouteQueryParam.SERVICE_ID);
  }

  /** True when any of the caller's own entries are in this queue. */
  protected hasMyEntries(): boolean {
    return this.visit.waitingEntries().some((e) => this.visit.isMine(e.entryId));
  }

  // Whether a fresh join is currently possible — salon open AND this queue open.
  // Mirrors the availability check the landing page's barber cards use.
  protected readonly joinable = computed(
    () => !!this.visit.salonData()?.isOpen && this.visit.queueStatus() === 'OPEN',
  );

  protected get myQueuesUrl() {
    return this._shellPrefix ? RoutePath.guestQueues() : RoutePath.queues();
  }

  ngOnInit(): void {
    this.visit.watchQueue(this._queueId);
  }

  // Join dialog is opened only after selectBarber()'s gate passes (guest ->
  // register redirect, existing entry -> position redirect are handled there
  // and both navigate away themselves; this only opens for a genuine fresh join).
  protected readonly joinDialogOpen = signal(false);

  protected openJoin(): void {
    const staff = this.visit.staffForQueue(this._queueId);
    if (staff && this.visit.selectBarber(staff, this._slug)) {
      this.joinDialogOpen.set(true);
    }
  }

  protected closeJoin(): void {
    this.joinDialogOpen.set(false);
  }

  // "View my works" gallery — the staff's own galleryUrls (already in the
  // slug response, no fetch), shown in the same modal the About tab uses.
  protected readonly galleryOpen = signal(false);

  protected openGallery(): void {
    this.galleryOpen.set(true);
  }

  protected closeGallery(): void {
    this.galleryOpen.set(false);
  }
}
