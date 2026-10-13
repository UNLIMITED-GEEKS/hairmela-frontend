import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Location, DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { SalonVisitService } from '../salon-visit.service';
import { JoinDialogComponent } from '../join-dialog/join-dialog.component';
import { BookAppointmentDialogComponent } from '../book-appointment-dialog/book-appointment-dialog.component';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { GalleryModalComponent } from '../../../shared/components/gallery-modal/gallery-modal.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { BackButtonComponent } from '../../../shared/components/back-button/back-button.component';
import { PushPromptComponent } from '../../../shared/components/push-prompt/push-prompt.component';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { FavoritesService } from '../../../core/favorites/favorites.service';
import { ToastService } from '../../../core/toast/toast.service';
import { RouteParam, RoutePath, RouteQueryParam } from '../../../core/routing/route-paths';
import { environment } from '../../../../environments/environment';
import { staffAvailability } from '../../../core/utils/staff-availability';
import { TimelineEntryDto } from '../../../core/socket/socket.types';

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
    InlineSpinnerComponent,
    DatePipe,
    // BackButtonComponent,
  ],
})
export class LiveQueueComponent {
  protected readonly visit = inject(SalonVisitService);
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _toast = inject(ToastService);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _favorites = inject(FavoritesService);

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

  protected readonly staffFavoritesCount = signal<number | null>(null);
  protected readonly staffFavoritesCountLoading = signal(false);
  private _lastFetchedStaffId: string | null = null;

  constructor() {
    effect(() => this.visit.watchQueue(this._queueId()));
    effect(() => {
      if (this._currentUser.user()) {
        this._favorites.ensureStaffIdsLoaded();
      }
    });
    effect(() => {
      const staff = this._currentStaff();
      const staffId = staff?.staffId;
      if (staffId && staffId !== this._lastFetchedStaffId) {
        this._lastFetchedStaffId = staffId;
        untracked(() => this._loadStaffFavoritesCount(staffId));
      }
    });
  }

  private async _loadStaffFavoritesCount(staffId: string): Promise<void> {
    this.staffFavoritesCount.set(null);
    this.staffFavoritesCountLoading.set(true);
    try {
      const count = await this._favorites.getStaffFavoritesCount(staffId);
      if (count !== null) {
        this.staffFavoritesCount.set(count);
      }
    } finally {
      this.staffFavoritesCountLoading.set(false);
    }
  }

  // Heart shown publicly with like count — guest visitors can see the count
  // and clicking prompts sign-in.
  protected readonly showHeart = computed(() => true);
  protected readonly isFavorited = computed(() => {
    const s = this._currentStaff();
    return s ? this._favorites.isStaffFavorited(s.staffId) : false;
  });

  protected toggleFavorite(): void {
    if (!this._currentUser.user()) {
      this._toast.info('Please sign in to save favourites');
      this._router.navigate(RoutePath.login(), {
        queryParams: { [RouteQueryParam.RETURN_URL]: this._router.url },
      });
      return;
    }

    const s = this._currentStaff();
    if (!s) return;

    const wasFavorited = this.isFavorited();
    const current = this.staffFavoritesCount();
    if (current !== null) {
      this.staffFavoritesCount.set(wasFavorited ? Math.max(0, current - 1) : current + 1);
    }
    this._favorites.toggleStaff({ staffId: s.staffId });
  }

  // "Getting the latest queue status" banner — shown whenever what's on
  // screen isn't confirmed current for this queue, this visit. That covers
  // both cases: a cold first load (nothing rendered yet, fetch in flight) and
  // a re-entry showing a stale cached replay while it re-confirms. Both need
  // the same "hang on, we're fetching" affordance — without it a cold load is
  // just a blank queue with no feedback at all.
  protected readonly refreshing = computed(() => !this.visit.timelineConfirmed());

  /** True when any of the caller's own entries are in this queue. */
  protected hasMyEntries(): boolean {
    return this.visit.waitingEntries().some((e) => this.visit.isMine(e.entryId));
  }

  // The status card shows a live wait for walk-ins, or the scheduled time for
  // an appointment. Without an entry, it shows a fresh joiner's wait.
  protected readonly myWaitingEntry = computed(
    () => this.visit.waitingEntries().find((e) => this.visit.isMine(e.entryId)) ?? null,
  );

  protected readonly myAppointment = computed(() => {
    const entry = this.myWaitingEntry();
    return entry?.type === 'APPOINTMENT' ? entry : null;
  });

  protected readonly estimatedWait = computed(() => {
    const entry = this.myWaitingEntry();
    return entry ? this.visit.liveWait(entry.entryId) : this.visit.backOfLineWait();
  });

  // People ahead: everyone currently waiting/serving when there's no entry
  // of my own yet; otherwise my position's index in the ordered list.
  // Excludes isUpcoming appointments — a not-yet-due booking (>10min out on
  // the public view) is shown in the list but takes no live-line position, so
  // it must not count as someone "ahead" (backend gives it position null and
  // 0 wait; this keeps the count consistent with that).
  protected readonly peopleAheadOfMe = computed(() => {
    const entries = this.visit.waitingEntries().filter((e) => !e.isUpcoming);
    const myIndex = entries.findIndex((e) => this.visit.isMine(e.entryId));
    return myIndex >= 0 ? myIndex : entries.length;
  });

  protected readonly servingEntry = computed(
    () => this.visit.waitingEntries().find((entry) => entry.members.some((member) => member.status === 'SERVING')) ?? null,
  );

  protected readonly upcomingCount = computed(
    () => this.visit.waitingEntries().filter((entry) => !entry.members.some((member) => member.status === 'SERVING')).length,
  );

  protected servingLabel(entry: TimelineEntryDto): string {
    return entry.position !== null ? `Client ${entry.position}` : 'Booked client';
  }

  // Real availability from the barber's own openState (backend-computed,
  // precedence-ordered) — see core/utils/staff-availability.ts. Same source
  // the landing page's barber cards use, so the two surfaces always agree.
  // null only while _currentStaff() hasn't resolved yet (not joinable).
  protected readonly availability = computed(() => {
    const staff = this._currentStaff();
    return staff ? staffAvailability(staff) : null;
  });

  // Frozen = the salon is over its org's plan limit; the backend rejects both
  // joins and appointments for it. Mirrors salon-landing's own frozen() gate,
  // which hides the barbers there — this page is reachable directly (deep
  // link, stored entry, back-nav), so it needs its own check rather than
  // relying on having come through the landing page.
  protected readonly frozen = computed(() => this.visit.salonData()?.isFrozen ?? false);

  // staffAvailability() covers schedule/availability only and knows nothing
  // about the salon being suspended, so frozen is applied on top. Note
  // selectBarber() already blocks a CLOSED salon, but a frozen-and-OPEN salon
  // passed straight through to the join dialog before this.
  protected readonly joinable = computed(
    () => (this.availability()?.joinable ?? false) && !this.frozen(),
  );

  /**
   * Whether the primary button is enabled, which depends on what it DOES.
   *
   * Walk-in salons use joinable() — a closed or paused queue can't be joined.
   * Appointments-only salons must not inherit that: booking ahead is precisely
   * what you do when the queue is shut, and the existing "Book an appointment"
   * button below gates on frozen() alone for the same reason.
   */
  protected readonly canStartVisit = computed(() =>
    this.visit.allowsWalkIns() ? this.joinable() : !this.frozen(),
  );

  protected get myQueuesUrl() {
    return this._shellPrefix ? RoutePath.guestQueues() : RoutePath.queues();
  }

  // Join dialog is opened only after selectBarber()'s gate passes (guest ->
  // register redirect, existing entry -> position redirect are handled there
  // and both navigate away themselves; this only opens for a genuine fresh join).
  protected readonly joinDialogOpen = signal(false);

  /**
   * The primary action on this page: join the walk-in queue, or — for a salon
   * that has turned walk-ins off — book an appointment instead.
   *
   * One handler rather than two buttons so the label (see the template) and
   * the dialog it opens are driven by the same condition and cannot disagree.
   */
  protected startVisit(): void {
    if (!this.visit.allowsWalkIns()) {
      this.openBookDialog();
      return;
    }
    this.openJoin();
  }

  protected openJoin(): void {
    const staff = this.visit.staffForQueue(this._queueId());
    if (staff && this.visit.selectBarber(staff, this._slug())) {
      this.joinDialogOpen.set(true);
    }
  }

  protected closeJoin(): void {
    this.joinDialogOpen.set(false);
  }

  protected readonly bookDialogOpen = signal(false);

  // The secondary "Not ready right now?" prompt is shown only for salons that
  // accept walk-ins. Guests can book directly and provide their contact
  // details in the appointment dialog.
  protected openBookDialog(): void {
    // The backend rejects appointments for a frozen salon either way — this
    // stops the customer filling a form that cannot succeed.
    if (this.frozen()) return;
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

  // Shareable link for this queue — always the prefix-neutral /s/... path
  // (not this._shellPrefix, which is per-visitor: '/g' for a guest session,
  // '' for a signed-in one). Whoever the link is shared WITH should land on
  // a fresh URL and get routed by their own session, not inherit the sharer's.
  protected copyQueueLink(): void {
    const path = RoutePath.visitQueue('', this._slug(), this._queueId()).join('/');
    navigator.clipboard
      .writeText(`${environment.appBaseUrl}${path}`)
      .then(() => this._toast.success('Queue link copied'))
      .catch(() => this._toast.error('Could not copy link'));
  }

  // Separate open-state for the barber's profile-photo lightbox — its own
  // instance so it never collides with the "View my works" gallery modal.
  protected readonly photoOpen = signal(false);

  protected openPhoto(): void {
    this.photoOpen.set(true);
  }
}
