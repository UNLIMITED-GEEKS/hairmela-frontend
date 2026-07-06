import { Injectable, DestroyRef, inject, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { filter, map, switchMap, tap } from 'rxjs';
import { Router } from '@angular/router';
import { ApiConfiguration } from '../../api/api-configuration';
import { QueueSocketService } from '../../core/socket/queue-socket.service';
import { CurrentUserStore } from '../../core/auth/current-user.store';
import { GuestStore } from '../../core/guest/guest-store';
import { ActiveEntryStore } from '../../core/queue/active-entry.store';
import { ConfirmDialogService } from '../../shared/components/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../core/toast/toast.service';
import { ErrorCodes } from '../../core/errors/error-codes';
import { isApiError } from '../../core/errors/api-error.types';
import { TimelineEntryDto } from '../../core/socket/socket.types';
import { SalonPublicDto } from '../../api/models/salon-public-dto';
import { SalonPublicStaffDto } from '../../api/models/salon-public-staff-dto';
import { Service } from '../../api/models/service';
import { Queue } from '../../api/models/queue';
import { JoinQueueDto } from '../../api/models/join-queue-dto';
import { publicSalonsControllerFindBySlug } from '../../api/fn/salons/public-salons-controller-find-by-slug';
import { publicServicesControllerFindBySalon } from '../../api/fn/services/public-services-controller-find-by-salon';
import { publicQueueControllerGetTimeline } from '../../api/fn/queues/public-queue-controller-get-timeline';
import { publicQueueControllerGetQueue } from '../../api/fn/queues/public-queue-controller-get-queue';
import { walkInControllerJoinQueue } from '../../api/fn/queues/walk-in-controller-join-queue';
import { walkInControllerLeaveQueue } from '../../api/fn/queues/walk-in-controller-leave-queue';
import { myEntriesControllerGetMyEntries } from '../../api/fn/queues/my-entries-controller-get-my-entries';
import { guestEntriesControllerGetGuestEntries } from '../../api/fn/queues/guest-entries-controller-get-guest-entries';

import { ActiveEntry } from '../../core/queue/active-entry.store';
export type { ActiveEntry };

export interface AddMemberRow {
  name: string;
  serviceId: string;
}

export type PendingJoin =
  | { status: 'pending' }
  | { status: 'joined'; entryId: string; queueId: string; slug: string; shellPrefix: string }
  | { status: 'failed'; reason: 'closed' | 'party-too-large' | 'generic' };

@Injectable({ providedIn: 'root' })
export class SalonVisitService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _socket = inject(QueueSocketService);
  private readonly _router = inject(Router);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _guestStore = inject(GuestStore);
  private readonly _activeEntryStore = inject(ActiveEntryStore);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _toast = inject(ToastService);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _tick = signal(0);
  private _tickInterval: ReturnType<typeof setInterval> | null = null;
  private _watchedQueueIds = new Set<string>();
  private _shellPrefix = '';
  private _socketInitialReceived = new Set<string>();

  readonly salonData = signal<SalonPublicDto | null>(null);
  readonly services = signal<Service[]>([]);
  readonly timeline = signal<TimelineEntryDto[]>([]);
  readonly queueStatus = signal<Queue['status'] | null>(null);
  // A customer can hold several entries in one queue (added-while-waiting creates
  // a new one at the back). Tracked as an array; views address a single entry by id.
  readonly activeEntries = signal<ActiveEntry[]>([]);
  readonly loading = signal(true);
  readonly timelineLoaded = signal(false);
  readonly joining = signal(false);
  readonly leaving = signal(false);
  readonly addingKids = signal(false);
  readonly calledVisible = signal(false);
  // Signal-based result for the navigation-is-feedback join flow.
  // Set to `pending` before navigating to /joining; resolved to `joined` or `failed`
  // by joinQueue(); the JoiningQueueComponent reads it and routes accordingly.
  // Writable by design — the JoiningQueueComponent clears it after handling.
  readonly pendingJoin = signal<PendingJoin | null>(null);

  readonly salon = computed(() => this.salonData()?.salon ?? null);
  readonly staffList = computed(() => this.salonData()?.staff ?? []);

  /** The live timeline entry for a specific entryId (the position page's entry). */
  myEntry(entryId: string): TimelineEntryDto | null {
    return this.timeline().find((e) => e.entryId === entryId) ?? null;
  }

  /** True if any of the user's own entries belong to this queue's timeline. */
  isMine(entryId: string): boolean {
    return this.activeEntries().some((e) => e.entryId === entryId);
  }

  readonly waitingEntries = computed(() =>
    this.timeline().filter((e) =>
      e.members.some((m) => m.status === 'WAITING' || m.status === 'SERVING'),
    ),
  );

  readonly maxPartySize = computed(() => {
    const settings = this.salon()?.settings as { maxPartySize?: number } | undefined;
    return settings?.maxPartySize ?? 5;
  });

  partyMembers(entryId: string): TimelineEntryDto['members'] {
    return this.myEntry(entryId)?.members ?? [];
  }

  private readonly _servingMember = computed(() => {
    for (const entry of this.timeline()) {
      const m = entry.members.find((m) => m.status === 'SERVING');
      if (m) return m;
    }
    return null;
  });

  private readonly _elapsedSeconds = computed(() => {
    this._tick();
    const servedAt = this._servingMember()?.servedAt;
    if (!servedAt) return 0;
    return Math.floor((Date.now() - new Date(servedAt).getTime()) / 1000);
  });

  readonly liveWaitMinutes = computed((): Map<string, number> => {
    this._tick();
    const elapsedMinutes = Math.floor(this._elapsedSeconds() / 60);
    const map = new Map<string, number>();
    for (const entry of this.timeline()) {
      map.set(entry.entryId, Math.max(0, entry.estimatedWaitMinutes - elapsedMinutes));
    }
    return map;
  });

  readonly memberWaitMinutes = computed((): Map<string, number> => {
    this._tick();
    const elapsedMinutes = Math.floor(this._elapsedSeconds() / 60);
    const map = new Map<string, number>();
    for (const entry of this.timeline()) {
      const isServing = entry.members.some((m) => m.status === 'SERVING');
      let pendingDuration = 0;
      for (const member of entry.members) {
        if (member.status === 'SERVED') {
          map.set(member.memberId, 0);
          continue;
        }
        if (member.status === 'SERVING') {
          map.set(member.memberId, 0);
          pendingDuration = member.serviceDuration - elapsedMinutes;
          continue;
        }
        const wait = isServing
          ? Math.max(0, pendingDuration)
          : Math.max(0, entry.estimatedWaitMinutes + pendingDuration);
        map.set(member.memberId, wait);
        pendingDuration += member.serviceDuration;
      }
    }
    return map;
  });

  init(slug: string, shellPrefix = ''): void {
    this._shellPrefix = shellPrefix;
    const storedEntries = this._activeEntryStore.getAll();
    this._loadSalon(slug, storedEntries);
    this._startTick();
  }

  destroy(): void {
    for (const queueId of this._watchedQueueIds) {
      this._socket.unwatchQueue(queueId);
    }
    this._watchedQueueIds.clear();
    this._socketInitialReceived.clear();
    this._stopTick();
    this._shellPrefix = '';
    this.salonData.set(null);
    this.services.set([]);
    this.timeline.set([]);
    this.queueStatus.set(null);
    this.activeEntries.set([]);
    this.loading.set(true);
    this.timelineLoaded.set(false);
    this.joining.set(false);
    this.leaving.set(false);
    this.addingKids.set(false);
    this.calledVisible.set(false);
    this.pendingJoin.set(null);
  }

  watchQueue(queueId: string): void {
    if (this._watchedQueueIds.has(queueId)) return;
    this._watchedQueueIds.add(queueId);

    this._socket.connect();
    this._socket.watchQueue(queueId);
    this._loadQueueStatus(queueId);
    this._loadInitialTimeline(queueId);

    this._socket
      .queueTimeline$(queueId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((entries) => {
        const isFirstMessage = !this._socketInitialReceived.has(queueId);
        this._socketInitialReceived.add(queueId);
        this._reconcileEntries(queueId, entries, isFirstMessage);
        this.timeline.set(entries);
        this.timelineLoaded.set(true);
      });
  }

  selectBarber(staff: SalonPublicStaffDto, slug: string): void {
    if (!staff.queueId) return;
    const isGuest = !!this._shellPrefix;
    if (!isGuest && !this._currentUser.user() && !this._guestStore.hasToken()) {
      this._router.navigate(['/register'], { queryParams: { returnUrl: `/s/${slug}` } });
      return;
    }
    const myEntries = this._activeEntryStore.getAllForQueue(staff.queueId!);
    const base = this._shellPrefix ? [this._shellPrefix, 's', slug] : ['s', slug];
    if (myEntries.length > 0) {
      // Already in this queue — open the position page for the (earliest) entry,
      // even if the salon is now closed (they may still be waiting).
      this._router.navigate([...base, 'q', staff.queueId, 'e', myEntries[0].entryId, 'position']);
      return;
    }
    // No existing entry — a fresh join is only allowed while the salon is open.
    if (!this.salonData()?.isOpen) return;
    this._router.navigate([...base, 'q', staff.queueId, 'join']);
  }

  joinQueue(salonId: string, queueId: string, salonSlug: string, body: JoinQueueDto): void {
    walkInControllerJoinQueue(this._http, this._apiConfig.rootUrl, { salonId, queueId, body })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          const entryId = res.body.entry.id;
          const guestToken = res.body.guestToken ?? null;
          const entry: ActiveEntry = { queueId, entryId, salonId, salonSlug };
          this.activeEntries.update((list) => [
            ...list.filter((e) => e.entryId !== entryId),
            entry,
          ]);
          this._activeEntryStore.save(entry);
          this._loadInitialTimeline(queueId);
          if (guestToken) this._guestStore.setToken(guestToken);
          this.pendingJoin.set({
            status: 'joined',
            entryId,
            queueId,
            slug: salonSlug,
            shellPrefix: this._shellPrefix,
          });
        },
        error: (err) => {
          const apiBody = (err as { error?: unknown })?.error;
          if (isApiError(apiBody) && apiBody.code === ErrorCodes.QUEUE_NOT_OPEN) {
            this.queueStatus.set('CLOSED');
            this.pendingJoin.set({ status: 'failed', reason: 'closed' });
          } else if (isApiError(apiBody) && apiBody.code === ErrorCodes.PARTY_TOO_LARGE) {
            this.pendingJoin.set({ status: 'failed', reason: 'party-too-large' });
          } else {
            this.pendingJoin.set({ status: 'failed', reason: 'generic' });
          }
        },
      });
  }

  leaveQueue(entryId: string, onSuccess: () => void): void {
    const entry = this._activeEntryStore.getByEntryId(entryId);
    if (!entry || this.leaving()) return;
    this._confirmDialog
      .open({
        title: 'Leave queue?',
        message: 'Your spot will be lost and you will need to rejoin.',
        confirmLabel: 'Leave',
        danger: true,
      })
      .pipe(
        filter((ok) => ok),
        tap(() => this.leaving.set(true)),
        // The interceptor attaches the guest token, so one path serves both.
        switchMap(() =>
          walkInControllerLeaveQueue(this._http, this._apiConfig.rootUrl, {
            salonId: entry.salonId,
            queueId: entry.queueId,
            entryId: entry.entryId,
          }),
        ),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe({
        next: () => {
          this.leaving.set(false);
          this._activeEntryStore.remove(entry.entryId);
          this.activeEntries.update((list) => list.filter((e) => e.entryId !== entry.entryId));
          this._toast.success('You have left the queue.');
          onSuccess();
        },
        error: () => this.leaving.set(false),
      });
  }

  // "Add someone while waiting" is just another join: it creates a NEW entry at
  // the back of the line (the leader of the new slot is the first added person).
  // The interceptor attaches the guest token, so there is no guest/auth fork.
  addMembers(sourceEntryId: string, members: AddMemberRow[], onSuccess: () => void): void {
    const entry = this._activeEntryStore.getByEntryId(sourceEntryId);
    const salon = this.salon();
    if (!entry || !salon || this.addingKids()) return;
    const valid = members.filter((k) => k.name?.trim());
    if (valid.length === 0) {
      onSuccess();
      return;
    }
    this.addingKids.set(true);
    const body: JoinQueueDto = {
      members: valid.map((k) => ({
        memberName: k.name.trim(),
        serviceId: k.serviceId || undefined,
      })),
    };

    walkInControllerJoinQueue(this._http, this._apiConfig.rootUrl, {
      salonId: salon.id,
      queueId: entry.queueId,
      body,
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          const newEntry: ActiveEntry = {
            queueId: entry.queueId,
            entryId: res.body.entry.id,
            salonId: salon.id,
            salonSlug: entry.salonSlug,
          };
          if (res.body.guestToken) this._guestStore.setToken(res.body.guestToken);
          this._activeEntryStore.save(newEntry);
          this.activeEntries.update((list) => [
            ...list.filter((e) => e.entryId !== newEntry.entryId),
            newEntry,
          ]);
          this.addingKids.set(false);
          this._loadInitialTimeline(entry.queueId);
          this._toast.success('Added to the back of the line.');
          onSuccess();
        },
        error: (err: unknown) => {
          this.addingKids.set(false);
          const apiBody = (err as { error?: unknown })?.error;
          if (isApiError(apiBody) && apiBody.code === ErrorCodes.PARTY_TOO_LARGE) {
            this._toast.error('Party size exceeds the maximum allowed.');
          }
        },
      });
  }

  staffServices(staff: SalonPublicStaffDto): Service[] {
    return this.services().filter((s) => staff.serviceIds.includes(s.id));
  }

  formatWait(minutes: number): string {
    if (minutes < 1) return '< 1m';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  liveWait(entryId: string): string {
    return this.formatWait(this.liveWaitMinutes().get(entryId) ?? 0);
  }

  memberWait(memberId: string): string {
    return this.formatWait(this.memberWaitMinutes().get(memberId) ?? 0);
  }

  /**
   * Estimated wait for someone joining now — they go behind everyone currently
   * waiting, so they wait until the last entry *finishes*: that entry's own wait
   * plus the duration of its still-pending members.
   */
  backOfLineWait(): string {
    const entries = this.waitingEntries();
    if (entries.length === 0) return this.formatWait(0);
    const liveWaits = this.liveWaitMinutes();
    const last = entries.reduce((a, b) =>
      (liveWaits.get(b.entryId) ?? 0) >= (liveWaits.get(a.entryId) ?? 0) ? b : a,
    );
    const lastWait = liveWaits.get(last.entryId) ?? 0;
    const lastPending = last.members
      .filter((m) => m.status === 'WAITING' || m.status === 'SERVING')
      .reduce((sum, m) => sum + m.serviceDuration, 0);
    return this.formatWait(lastWait + lastPending);
  }

  staffForQueue(queueId: string): SalonPublicStaffDto | null {
    return this.salonData()?.staff.find((s) => s.queueId === queueId) ?? null;
  }

  private _loadSalon(slug: string, storedEntries: ActiveEntry[]): void {
    publicSalonsControllerFindBySlug(this._http, this._apiConfig.rootUrl, { slug })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          this.salonData.set(res.body);
          this.loading.set(false);
          publicServicesControllerFindBySalon(this._http, this._apiConfig.rootUrl, {
            salonId: res.body.salon.id,
          })
            .pipe(takeUntilDestroyed(this._destroyRef))
            .subscribe({ next: (svc) => this.services.set(svc.body) });
          for (const stored of storedEntries) {
            const matchesStaff = res.body.staff.some((s) => s.queueId === stored.queueId);
            if (matchesStaff) {
              this.watchQueue(stored.queueId);
              break;
            }
          }
        },
        error: () => {
          this.loading.set(false);
          this._toast.error('Salon not found');
        },
      });
  }

  private _loadQueueStatus(queueId: string): void {
    publicQueueControllerGetQueue(this._http, this._apiConfig.rootUrl, { queueId })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({ next: (res) => this.queueStatus.set(res.body.status) });
  }

  private _loadInitialTimeline(queueId: string): void {
    publicQueueControllerGetTimeline(this._http, this._apiConfig.rootUrl, { queueId })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          const entries = res.body;
          const stored = this._activeEntryStore.getAllForQueue(queueId);
          if (stored.length > 0) {
            this._reconcileEntries(queueId, entries, true);
            this.timeline.set(entries);
            this.timelineLoaded.set(true);
            return;
          }
          // No stored entries — recover all of the caller's entries for this queue.
          // my-entries (auth) / guest-entries (guest) both carry the guest token via
          // the interceptor now, so guest-entries no longer needs the manual client.
          const recover$ = this._currentUser.user()
            ? myEntriesControllerGetMyEntries(this._http, this._apiConfig.rootUrl).pipe(
                map((r) => r.body),
              )
            : this._guestStore.hasToken()
              ? guestEntriesControllerGetGuestEntries(this._http, this._apiConfig.rootUrl).pipe(
                  map((r) => r.body),
                )
              : null;
          if (!recover$) {
            this.timeline.set(entries);
            this.timelineLoaded.set(true);
            return;
          }
          recover$.pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
            next: (myEntries) => {
              const salon = this.salon();
              const recovered = myEntries
                .filter((e) => e.queueId === queueId)
                .map(
                  (e): ActiveEntry => ({
                    queueId,
                    entryId: e.id,
                    salonId: salon?.id ?? '',
                    salonSlug: salon?.slug ?? '',
                  }),
                );
              for (const entry of recovered) this._activeEntryStore.save(entry);
              if (recovered.length > 0) {
                this.activeEntries.update((list) => {
                  const ids = new Set(recovered.map((e) => e.entryId));
                  return [...list.filter((e) => !ids.has(e.entryId)), ...recovered];
                });
              }
              this.timeline.set(entries);
              this.timelineLoaded.set(true);
            },
            error: () => {
              this.timeline.set(entries);
              this.timelineLoaded.set(true);
            },
          });
        },
      });
  }

  /**
   * Reconciles the caller's stored entries for a queue against the live timeline:
   * keeps the ones still present, drops the ones that vanished (served/cancelled),
   * and fires the "you're up" banner when one of the caller's own entries starts
   * being served. Used by both the socket stream and the REST fallback.
   */
  private _reconcileEntries(
    queueId: string,
    entries: TimelineEntryDto[],
    isFirstMessage: boolean,
  ): void {
    const stored = this._activeEntryStore.getAllForQueue(queueId);
    const live: ActiveEntry[] = [];
    for (const entry of stored) {
      const timelineEntry = entries.find((e) => e.entryId === entry.entryId);
      if (timelineEntry) {
        live.push(entry);
        if (!isFirstMessage && timelineEntry.members.some((m) => m.status === 'SERVING')) {
          this.calledVisible.set(true);
          setTimeout(() => this.calledVisible.set(false), 5000);
        }
      } else {
        this._activeEntryStore.remove(entry.entryId);
      }
    }
    // Merge this queue's live entries into the cross-queue active list.
    this.activeEntries.update((list) => {
      const others = list.filter((e) => e.queueId !== queueId);
      return [...others, ...live];
    });
  }

  private _startTick(): void {
    this._tickInterval = setInterval(() => this._tick.update((n) => n + 1), 1000);
  }

  private _stopTick(): void {
    if (this._tickInterval) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
  }
}
