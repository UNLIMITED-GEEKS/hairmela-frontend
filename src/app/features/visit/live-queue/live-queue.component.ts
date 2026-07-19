import { Component, computed, effect, inject, signal } from '@angular/core';
import { Location, DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { SalonVisitService } from '../salon-visit.service';
import { JoinDialogComponent } from '../join-dialog/join-dialog.component';
import { BookAppointmentDialogComponent } from '../book-appointment-dialog/book-appointment-dialog.component';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { GalleryModalComponent } from '../../../shared/components/gallery-modal/gallery-modal.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { BackButtonComponent } from '../../../shared/components/back-button/back-button.component';
import { PushPromptComponent } from '../../../shared/components/push-prompt/push-prompt.component';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { RouteParam, RoutePath, RouteQueryParam } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-live-queue',
  templateUrl: './live-queue.component.html',
  imports: [
    // RouterLink,
    JoinDialogComponent,
    BookAppointmentDialogComponent,
    AvatarComponent,
    GalleryModalComponent,
    IconComponent,
    PushPromptComponent,
    DatePipe,
    // BackButtonComponent,
  ],
})
export class LiveQueueComponent {
  protected readonly visit = inject(SalonVisitService);
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _currentUser = inject(CurrentUserStore);

  // Reactive, not snapshot-based — q/:queueId is a single route, so navigating
  // between two barbers (q/A -> q/B) reuses this component instance and never
  // re-runs a one-time init; only the paramMap actually updates, which is why
  // these must be signals derived from it rather than snapshot getters.
  private readonly _paramMap = toSignal(this._route.paramMap, { requireSync: true });
  private readonly _queryParamMap = toSignal(this._route.queryParamMap, { requireSync: true });

  protected readonly _queueId = computed(() => this._paramMap().get(RouteParam.QUEUE_ID) ?? '');
  protected readonly _slug = computed(() => this._paramMap().get(RouteParam.SLUG) ?? '');

  protected get _shellPrefix(): string {
    return this._route.snapshot.data['shellPrefix'] ?? '';
  }

  // Memoized — staffForQueue() itself does an array .find() and returns a new
  // object reference on every call, so binding it inline in an @if(...; as x)
  // block makes Angular see a "changed" value on every change-detection tick
  // (this page's clock/socket-driven wait-time updates trigger many) and tear
  // down + rebuild the block's content each time. That silently reset
  // BookAppointmentDialogComponent's internal state (date, selected slot,
  // form) mid-interaction. computed() only re-derives when its actual
  // dependencies (_queueId, salonData) change, so the reference stays stable
  // across unrelated CD ticks.
  protected readonly _currentStaff = computed(() => this.visit.staffForQueue(this._queueId()));

  // Carried from the Services tab's barber-drilldown (?serviceId=...) so the
  // join dialog can pre-fill it; absent when arriving via the Staffs tab.
  protected readonly _serviceId = computed(() =>
    this._queryParamMap().get(RouteQueryParam.SERVICE_ID),
  );

  constructor() {
    effect(() => this.visit.watchQueue(this._queueId()));
  }

  /** True when any of the caller's own entries are in this queue. */
  protected hasMyEntries(): boolean {
    return this.visit.waitingEntries().some((e) => this.visit.isMine(e.entryId));
  }

  // Estimated Wait Time hero card — always shown. If the caller already has
  // an entry in this queue, it's their own live wait; otherwise it's the
  // wait a fresh joiner would face (back of the line).
  protected readonly myWaitingEntry = computed(
    () => this.visit.waitingEntries().find((e) => this.visit.isMine(e.entryId)) ?? null,
  );

  protected readonly estimatedWait = computed(() => {
    const entry = this.myWaitingEntry();
    return entry ? this.visit.liveWait(entry.entryId) : this.visit.backOfLineWait();
  });

  // People ahead: everyone currently waiting/serving when there's no entry
  // of my own yet; otherwise my position's index in the ordered list.
  protected readonly peopleAheadOfMe = computed(() => {
    const entries = this.visit.waitingEntries();
    const myIndex = entries.findIndex((e) => this.visit.isMine(e.entryId));
    return myIndex >= 0 ? myIndex : entries.length;
  });

  // Whether a fresh join is currently possible — salon open AND this queue open.
  // Mirrors the availability check the landing page's barber cards use.
  protected readonly joinable = computed(
    () => !!this.visit.salonData()?.isOpen && this.visit.queueStatus() === 'OPEN',
  );

  protected get myQueuesUrl() {
    return this._shellPrefix ? RoutePath.guestQueues() : RoutePath.queues();
  }

  // Join dialog is opened only after selectBarber()'s gate passes (guest ->
  // register redirect, existing entry -> position redirect are handled there
  // and both navigate away themselves; this only opens for a genuine fresh join).
  protected readonly joinDialogOpen = signal(false);

  protected openJoin(): void {
    const staff = this.visit.staffForQueue(this._queueId());
    if (staff && this.visit.selectBarber(staff, this._slug())) {
      this.joinDialogOpen.set(true);
    }
  }

  protected closeJoin(): void {
    this.joinDialogOpen.set(false);
  }

  // "Not ready today? Book an appointment" — authenticated customers only.
  // Absence, not a disabled control, for guests — same pattern as showHeart
  // on salon-landing.
  protected readonly showBookAppointment = computed(() => !!this._currentUser.user());

  protected readonly bookDialogOpen = signal(false);

  protected openBookDialog(): void {
    this.bookDialogOpen.set(true);
  }

  protected closeBookDialog(): void {
    this.bookDialogOpen.set(false);
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

  // Separate open-state for the barber's profile-photo lightbox — its own
  // instance so it never collides with the "View my works" gallery modal.
  protected readonly photoOpen = signal(false);

  protected openPhoto(): void {
    this.photoOpen.set(true);
  }
}
