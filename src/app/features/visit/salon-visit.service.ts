import { Injectable, DestroyRef, inject, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { filter, map, switchMap, tap } from 'rxjs';
import { Router } from '@angular/router';
import { ApiConfiguration } from '../../api/api-configuration';
import { QueueSocketService } from '../../core/socket/queue-socket.service';
import { CurrentUserStore } from '../../core/auth/current-user.store';
import { GuestStore } from '../../core/guest/guest-store';
import { GuestHttpService } from '../../core/guest/guest-http.service';
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
import { walkInControllerAddMembersToEntry } from '../../api/fn/queues/walk-in-controller-add-members-to-entry';
import { myEntriesControllerGetMyEntries } from '../../api/fn/queues/my-entries-controller-get-my-entries';

import { ActiveEntry } from '../../core/queue/active-entry.store';
export type { ActiveEntry };

export interface AddMemberRow {
  name: string;
  serviceId: string;
}

@Injectable({ providedIn: 'root' })
export class SalonVisitService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _socket = inject(QueueSocketService);
  private readonly _router = inject(Router);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _guestStore = inject(GuestStore);
  private readonly _guestHttp = inject(GuestHttpService);
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
  readonly activeEntry = signal<ActiveEntry | null>(null);
  readonly loading = signal(true);
  readonly timelineLoaded = signal(false);
  readonly joining = signal(false);
  readonly leaving = signal(false);
  readonly addingKids = signal(false);
  readonly calledVisible = signal(false);

  readonly salon = computed(() => this.salonData()?.salon ?? null);
  readonly staffList = computed(() => this.salonData()?.staff ?? []);

  readonly myEntry = computed(() => {
    const entry = this.activeEntry();
    if (!entry) return null;
    return this.timeline().find((e) => e.entryId === entry.entryId) ?? null;
  });

  readonly waitingEntries = computed(() =>
    this.timeline().filter((e) =>
      e.members.some((m) => m.status === 'WAITING' || m.status === 'SERVING'),
    ),
  );

  readonly maxPartySize = computed(() => {
    const settings = this.salon()?.settings as { maxPartySize?: number } | undefined;
    return settings?.maxPartySize ?? 5;
  });

  readonly isCalled = computed(() => {
    const entry = this.myEntry();
    if (!entry) return false;
    return entry.members.some((m) => m.status === 'SERVING');
  });

  readonly partyMembers = computed(() => {
    const entry = this.myEntry();
    if (!entry) return [];
    return entry.members;
  });

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
        if (member.status === 'SERVED') { map.set(member.memberId, 0); continue; }
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
    this.activeEntry.set(null);
    this.loading.set(true);
    this.timelineLoaded.set(false);
    this.joining.set(false);
    this.leaving.set(false);
    this.addingKids.set(false);
    this.calledVisible.set(false);
  }

  watchQueue(queueId: string): void {
    if (this._watchedQueueIds.has(queueId)) return;
    this._watchedQueueIds.add(queueId);

    this._socket.connect();
    this._socket.watchQueue(queueId);
    this._loadQueueStatus(queueId);
    this._loadInitialTimeline(queueId);

    this._socket.queueTimeline$(queueId).pipe(
      takeUntilDestroyed(this._destroyRef),
    ).subscribe((entries) => {
      const isFirstMessage = !this._socketInitialReceived.has(queueId);
      this._socketInitialReceived.add(queueId);
      const existing = this.activeEntry() ?? this._activeEntryStore.getForQueue(queueId) ?? null;
      if (existing) {
        const myTimelineEntry = entries.find((e) => e.entryId === existing.entryId);
        if (myTimelineEntry) {
          this.activeEntry.set(existing);
          if (!isFirstMessage && myTimelineEntry.members.some((m) => m.status === 'SERVING')) {
            this.calledVisible.set(true);
            setTimeout(() => this.calledVisible.set(false), 5000);
          }
        } else {
          this._activeEntryStore.remove(queueId);
          this.activeEntry.set(null);
        }
      }
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
    const alreadyInQueue = this._activeEntryStore.getForQueue(staff.queueId!) !== null;
    const base = this._shellPrefix ? [this._shellPrefix, 's', slug] : ['s', slug];
    if (alreadyInQueue) {
      this._router.navigate([...base, 'q', staff.queueId, 'position']);
    } else {
      this._router.navigate([...base, 'q', staff.queueId, 'join']);
    }
  }

  joinQueue(
    salonId: string,
    queueId: string,
    salonSlug: string,
    body: JoinQueueDto,
    onSuccess: (guestToken: string | null) => void,
  ): void {
    if (this.joining()) return;
    this.joining.set(true);
    walkInControllerJoinQueue(this._http, this._apiConfig.rootUrl, { salonId, queueId, body })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          const entry: ActiveEntry = { queueId, entryId: res.body.entry.id, salonId, salonSlug };
          this.activeEntry.set(entry);
          this._activeEntryStore.save(entry);
          this._loadInitialTimeline(queueId);
          this.joining.set(false);
          onSuccess(res.body.guestToken ?? null);
        },
        error: (err) => {
          this.joining.set(false);
          const apiBody = (err as { error?: unknown })?.error;
          if (isApiError(apiBody) && apiBody.code === ErrorCodes.QUEUE_NOT_OPEN) {
            this._toast.info('Queue is not open right now.');
            this.queueStatus.set('CLOSED');
          }
        },
      });
  }

  leaveQueue(onSuccess: () => void): void {
    const entry = this.activeEntry();
    if (!entry || this.leaving()) return;
    this._confirmDialog.open({
      title: 'Leave queue?',
      message: 'Your spot will be lost and you will need to rejoin.',
      confirmLabel: 'Leave',
      danger: true,
    }).pipe(
      filter((ok) => ok),
      tap(() => this.leaving.set(true)),
      // guest and auth use different HTTP clients — FlexAuthGuard on backend accepts both
      switchMap(() => this._guestStore.hasToken()
        ? this._guestHttp.leaveQueue(entry.salonId, entry.queueId, entry.entryId)
        : walkInControllerLeaveQueue(this._http, this._apiConfig.rootUrl, {
            salonId: entry.salonId, queueId: entry.queueId, entryId: entry.entryId,
          }),
      ),
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: () => {
        this.leaving.set(false);
        this._activeEntryStore.remove(entry.queueId);
        this.activeEntry.set(null);
        this._toast.success('You have left the queue.');
        onSuccess();
      },
      error: () => this.leaving.set(false),
    });
  }

  addMembers(members: AddMemberRow[], onSuccess: () => void): void {
    const entry = this.activeEntry();
    const salon = this.salon();
    if (!entry || !salon || this.addingKids()) return;
    const valid = members.filter((k) => k.name?.trim());
    if (valid.length === 0) { onSuccess(); return; }
    this.addingKids.set(true);
    const body = { members: valid.map((k) => ({ memberName: k.name.trim(), serviceId: k.serviceId || undefined })) };

    // guest and auth use different HTTP clients — FlexAuthGuard on backend accepts both
    const request$: Observable<void> = this._guestStore.hasToken()
      ? this._guestHttp.addMembers(salon.id, entry.queueId, entry.entryId, body).pipe(map(() => undefined as void))
      : walkInControllerAddMembersToEntry(this._http, this._apiConfig.rootUrl, {
          salonId: salon.id, queueId: entry.queueId, entryId: entry.entryId, body,
        }).pipe(map(() => undefined as void));

    request$.pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: () => {
        this.addingKids.set(false);
        this._loadInitialTimeline(entry.queueId);
        this._toast.success('Kids added to your queue entry.');
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
          publicServicesControllerFindBySalon(this._http, this._apiConfig.rootUrl, { salonId: res.body.salon.id })
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
        error: () => { this.loading.set(false); this._toast.error('Salon not found'); },
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
          const existing = this.activeEntry() ?? this._activeEntryStore.getForQueue(queueId) ?? null;
          if (existing) {
            const found = entries.find((e) => e.entryId === existing.entryId);
            this.activeEntry.set(found ? existing : null);
            if (!found) this._activeEntryStore.remove(queueId);
            this.timeline.set(entries);
            this.timelineLoaded.set(true);
          } else if (this._currentUser.user()) {
            // Auth user with no stored entry — fetch my-entries to recover entryId
            myEntriesControllerGetMyEntries(this._http, this._apiConfig.rootUrl)
              .pipe(takeUntilDestroyed(this._destroyRef))
              .subscribe({
                next: (myRes) => {
                  const mine = myRes.body.find((e) => e.queueId === queueId);
                  if (mine) {
                    const salon = this.salon();
                    const recovered: ActiveEntry = {
                      queueId,
                      entryId: mine.id,
                      salonId: salon?.id ?? '',
                      salonSlug: salon?.slug ?? '',
                    };
                    this._activeEntryStore.save(recovered);
                    this.activeEntry.set(recovered);
                  }
                  this.timeline.set(entries);
                  this.timelineLoaded.set(true);
                },
                error: () => { this.timeline.set(entries); this.timelineLoaded.set(true); },
              });
          } else {
            this.timeline.set(entries);
            this.timelineLoaded.set(true);
          }
        },
      });
  }

  private _startTick(): void {
    this._tickInterval = setInterval(() => this._tick.update((n) => n + 1), 1000);
  }

  private _stopTick(): void {
    if (this._tickInterval) { clearInterval(this._tickInterval); this._tickInterval = null; }
  }

}
