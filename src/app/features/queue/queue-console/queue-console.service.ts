import { Injectable, DestroyRef, inject, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { filter, retry, switchMap, tap } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { QueueSocketService } from '../../../core/socket/queue-socket.service';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../../core/toast/toast.service';
import { ErrorCodes } from '../../../core/errors/error-codes';
import { isApiError } from '../../../core/errors/api-error.types';
import { TimelineEntryDto } from '../../../core/socket/socket.types';
import { Queue } from '../../../api/models/queue';
import { ExtendMemberDto } from '../../../api/models/extend-member-dto';
import { publicQueueControllerGetTimeline } from '../../../api/fn/queues/public-queue-controller-get-timeline';
import { publicQueueControllerGetQueue } from '../../../api/fn/queues/public-queue-controller-get-queue';
import { queueManagementControllerSetStatus } from '../../../api/fn/queues/queue-management-controller-set-status';
import { queueManagementControllerCallNext } from '../../../api/fn/queues/queue-management-controller-call-next';
import { queueManagementControllerServeMember } from '../../../api/fn/queues/queue-management-controller-serve-member';
import { queueManagementControllerCompleteAllMembers } from '../../../api/fn/queues/queue-management-controller-complete-all-members';
import { queueManagementControllerCompleteMember } from '../../../api/fn/queues/queue-management-controller-complete-member';
import { queueManagementControllerExtendMember } from '../../../api/fn/queues/queue-management-controller-extend-member';
import { queueManagementControllerMarkNoShow } from '../../../api/fn/queues/queue-management-controller-mark-no-show';
import { queueManagementControllerCancelEntry } from '../../../api/fn/queues/queue-management-controller-cancel-entry';
import { walkInControllerStaffAddToQueue } from '../../../api/fn/queues/walk-in-controller-staff-add-to-queue';
import { staffServicesControllerGetStaffServices } from '../../../api/fn/services/staff-services-controller-get-staff-services';
import { StaffService } from '../../../api/models/staff-service';
import { SocketPredictService } from '../../../core/socket/socket-predict.service';

@Injectable()
export class QueueConsoleService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _socket = inject(QueueSocketService);
  private readonly _socketPredict = inject(SocketPredictService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _toast = inject(ToastService);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _tick = signal(0);
  private _tickInterval: ReturnType<typeof setInterval> | null = null;
  // Tracks whether a socket frame has arrived for the current queue session.
  // The REST GET in init() is a fallback for a slow socket; if a socket frame
  // lands first, a later REST response must not stomp it.
  private _socketInitialReceived = false;

  readonly queue = signal<Queue | null>(null);
  readonly timeline = signal<TimelineEntryDto[]>([]);
  readonly staffServices = signal<StaffService[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly acting = signal(false);

  readonly queueStatus = computed(() => this.queue()?.status ?? 'CLOSED');

  readonly servingEntry = computed(() =>
    this.timeline().find((e) => e.members.some((m) => m.status === 'SERVING')),
  );

  readonly servingMember = computed(() =>
    this.servingEntry()?.members.find((m) => m.status === 'SERVING'),
  );

  readonly waitingEntries = computed(() =>
    this.timeline().filter((e) => e.members.every((m) => m.status === 'WAITING')),
  );

  readonly servingPartyMembers = computed(() => {
    const entry = this.servingEntry();
    if (!entry) return [];
    return entry.members.filter((m) => m.status === 'WAITING' || m.status === 'SERVING');
  });

  readonly queueListEntries = computed(() => {
    const serving = this.servingEntry();
    const waiting = this.waitingEntries();
    return serving ? [serving, ...waiting] : waiting;
  });

  private readonly _elapsedSeconds = computed(() => {
    this._tick();
    const servedAt = this.servingMember()?.servedAt;
    if (!servedAt) return 0;
    return Math.floor((Date.now() - new Date(servedAt).getTime()) / 1000);
  });

  readonly timerFromServedAt = computed(() => {
    const s = this._elapsedSeconds();
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  });

  readonly estimatedFinishTime = computed(() => {
    const member = this.servingMember();
    if (!member?.servedAt) return null;
    const finishMs = new Date(member.servedAt).getTime() + member.serviceDuration * 60 * 1000;
    return new Date(finishMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
        // WAITING
        const wait = isServing
          ? Math.max(0, pendingDuration)
          : Math.max(0, entry.estimatedWaitMinutes + pendingDuration);
        map.set(member.memberId, wait);
        pendingDuration += member.serviceDuration;
      }
    }
    return map;
  });

  init(salonId: string, queueId: string): void {
    this._socketInitialReceived = false;
    this._loadQueueStatus(salonId, queueId);
    this._socket
      .queueTimeline$(queueId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((entries) => {
        this._socketInitialReceived = true;
        this.timeline.set(entries);
        this.loading.set(false);
      });
    this._socket.watchQueueAsStaff(queueId);
    publicQueueControllerGetTimeline(this._http, this._apiConfig.rootUrl, { queueId })
      .pipe(retry(1), takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          // Skip if the socket already delivered a fresher frame — the socket is
          // the authoritative source and always contains the latest server state.
          if (this._socketInitialReceived) return;
          this.timeline.set(res.body.timeline);
          this.loading.set(false);
        },
        error: () => {
          if (this._socketInitialReceived) return; // socket already loaded — not a failure
          this.loading.set(false);
          this.error.set(true);
        },
      });
    this._startTick();
  }

  destroy(queueId: string): void {
    this._socket.unwatchQueue(queueId);
    this._stopTick();
  }

  setStatus(salonId: string, queueId: string, status: 'OPEN' | 'PAUSED' | 'CLOSED'): void {
    if (this.acting()) return;
    const prev = this.queue();
    this.acting.set(true);
    this._socketPredict.run({
      signal: this.queue,
      apply: (q) => (q ? { ...q, status } : q),
      request: () =>
        queueManagementControllerSetStatus(this._http, this._apiConfig.rootUrl, {
          salonId,
          queueId,
          body: { status },
        }),
      onSuccess: (res) => this.queue.set(res.body),
      onError: () => {
        this.queue.set(prev);
        this._toast.error('Failed to update queue status');
      },
      destroyRef: this._destroyRef,
      onSettled: () => this.acting.set(false),
    });
  }

  callNext(salonId: string, queueId: string, onResolveNeeded: () => void): void {
    const waiting = this.waitingEntries();
    if (waiting.length === 0) return;
    const head = waiting[0];

    this._socketPredict.run({
      signal: this.timeline,
      apply: (t) =>
        t.map((e) =>
          e.entryId !== head.entryId
            ? e
            : {
                ...e,
                members: e.members.map((m) =>
                  m.isLeader && m.status === 'WAITING'
                    ? { ...m, status: 'SERVING' as const, servedAt: new Date().toISOString() }
                    : m,
                ),
              },
        ),
      targetIds: [head.entryId],
      request: () =>
        queueManagementControllerCallNext(this._http, this._apiConfig.rootUrl, {
          salonId,
          queueId,
        }),
      onError: (err) => {
        // Revert by re-asserting authority
        this._refetchTimeline(queueId);
        const body = (err as { error?: unknown })?.error;
        if (
          isApiError(body) &&
          (body.code === ErrorCodes.ENTRY_ALREADY_SERVING ||
            body.code === ErrorCodes.ENTRY_NOT_WAITING)
        ) {
          onResolveNeeded();
        } else {
          this._toast.info('Resolve the current client first before calling the next one.');
        }
      },
      destroyRef: this._destroyRef,
    });
  }

  endSession(salonId: string, queueId: string): void {
    const member = this.servingMember();
    const entry = this.servingEntry();
    if (!member || !entry) return;
    this._confirmDialog
      .open({
        title: 'End session?',
        message: `Mark ${member.memberName} as complete?`,
        confirmLabel: 'End Session',
        danger: false,
      })
      .pipe(
        filter((ok) => ok),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(() => {
        this._socketPredict.run({
          signal: this.timeline,
          apply: (t) =>
            t.map((e) =>
              e.entryId !== entry.entryId
                ? e
                : {
                    ...e,
                    members: e.members.map((m) =>
                      m.memberId === member.memberId ? { ...m, status: 'SERVED' as const } : m,
                    ),
                  },
            ),
          request: () =>
            queueManagementControllerCompleteMember(this._http, this._apiConfig.rootUrl, {
              salonId,
              queueId,
              entryId: entry.entryId,
              memberId: member.memberId,
            }),
          onError: () => this._refetchTimeline(queueId),
          destroyRef: this._destroyRef,
        });
      });
  }

  endAllMembers(salonId: string, queueId: string): void {
    const entry = this.servingEntry();
    if (!entry) return;
    this._socketPredict.run({
      signal: this.timeline,
      apply: (t) =>
        t.map((e) =>
          e.entryId !== entry.entryId
            ? e
            : { ...e, members: e.members.map((m) => ({ ...m, status: 'SERVED' as const })) },
        ),
      request: () =>
        queueManagementControllerCompleteAllMembers(this._http, this._apiConfig.rootUrl, {
          salonId,
          queueId,
          entryId: entry.entryId,
        }),
      onError: () => this._refetchTimeline(queueId),
      destroyRef: this._destroyRef,
    });
  }

  completeMember(salonId: string, queueId: string, entryId: string, memberId: string): void {
    this._socketPredict.run({
      signal: this.timeline,
      apply: (t) =>
        t.map((e) =>
          e.entryId !== entryId
            ? e
            : {
                ...e,
                members: e.members.map((m) =>
                  m.memberId === memberId ? { ...m, status: 'SERVED' as const } : m,
                ),
              },
        ),
      targetIds: [entryId, memberId],
      request: () =>
        queueManagementControllerCompleteMember(this._http, this._apiConfig.rootUrl, {
          salonId,
          queueId,
          entryId,
          memberId,
        }),
      onError: () => this._refetchTimeline(queueId),
      destroyRef: this._destroyRef,
    });
  }

  noShow(salonId: string, queueId: string, entryId: string): void {
    if (entryId.startsWith('temp_')) {
      this._toast.error('Still saving — try again in a moment.');
      return;
    }
    this._confirmDialog
      .open({
        title: 'Mark as no-show?',
        message: 'This client will be removed from the queue.',
        confirmLabel: 'No-show',
        danger: true,
      })
      .pipe(
        filter((ok) => ok),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(() => {
        this._socketPredict.run({
          signal: this.timeline,
          apply: (t) => t.filter((e) => e.entryId !== entryId),
          targetIds: [entryId],
          request: () =>
            queueManagementControllerMarkNoShow(this._http, this._apiConfig.rootUrl, {
              salonId,
              queueId,
              entryId,
            }),
          onError: () => this._refetchTimeline(queueId),
          destroyRef: this._destroyRef,
        });
      });
  }

  cancelEntry(salonId: string, queueId: string, entryId: string): void {
    if (entryId.startsWith('temp_')) {
      this._toast.error('Still saving — try again in a moment.');
      return;
    }
    this._confirmDialog
      .open({
        title: 'Cancel entry?',
        message: 'Remove this client from the queue entirely.',
        confirmLabel: 'Yes',
        danger: true,
      })
      .pipe(
        filter((ok) => ok),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(() => {
        this._socketPredict.run({
          signal: this.timeline,
          apply: (t) => t.filter((e) => e.entryId !== entryId),
          targetIds: [entryId],
          request: () =>
            queueManagementControllerCancelEntry(this._http, this._apiConfig.rootUrl, {
              salonId,
              queueId,
              entryId,
            }),
          onError: () => this._refetchTimeline(queueId),
          destroyRef: this._destroyRef,
        });
      });
  }

  serveMember(salonId: string, queueId: string, entryId: string, memberId: string): void {
    this._socketPredict.run({
      signal: this.timeline,
      apply: (t) =>
        t.map((e) =>
          e.entryId !== entryId
            ? e
            : {
                ...e,
                members: e.members.map((m) =>
                  m.memberId === memberId
                    ? { ...m, status: 'SERVING' as const, servedAt: new Date().toISOString() }
                    : m,
                ),
              },
        ),
      targetIds: [entryId, memberId],
      request: () =>
        queueManagementControllerServeMember(this._http, this._apiConfig.rootUrl, {
          salonId,
          queueId,
          entryId,
          memberId,
        }),
      onError: () => this._refetchTimeline(queueId),
      destroyRef: this._destroyRef,
    });
  }

  extendMember(
    salonId: string,
    queueId: string,
    entryId: string,
    memberId: string,
    body: ExtendMemberDto,
  ): void {
    this._socketPredict.run({
      signal: this.timeline,
      apply: (t) =>
        t.map((e) =>
          e.entryId !== entryId
            ? e
            : {
                ...e,
                members: e.members.map((m) =>
                  m.memberId === memberId
                    ? { ...m, serviceDuration: m.serviceDuration + body.extraMinutes }
                    : m,
                ),
              },
        ),
      targetIds: [entryId, memberId],
      request: () =>
        queueManagementControllerExtendMember(this._http, this._apiConfig.rootUrl, {
          salonId,
          queueId,
          entryId,
          memberId,
          body,
        }),
      onError: () => this._refetchTimeline(queueId),
      destroyRef: this._destroyRef,
    });
  }

  staffAddToQueue(
    salonId: string,
    queueId: string,
    members: { memberName: string; serviceId?: string }[],
    onSuccess?: () => void,
  ): void {
    // Build a temp entry from form data + staff services for instant paint
    const services = this.staffServices();
    const current = this.timeline();
    const lastPosition = current.length > 0 ? Math.max(...current.map((e) => e.position)) : 0;
    const lastWait =
      current.length > 0 ? Math.max(...current.map((e) => e.estimatedWaitMinutes)) : 0;
    const tempEntry: TimelineEntryDto = {
      entryId: `temp_${crypto.randomUUID()}`,
      position: lastPosition + 1,
      estimatedWaitMinutes: lastWait,
      members: members.map((m, i) => {
        const svc = services.find((s) => s.serviceId === m.serviceId);
        return {
          memberId: `temp_${crypto.randomUUID()}`,
          memberName: m.memberName,
          isLeader: i === 0,
          status: 'WAITING' as const,
          servedAt: null,
          serviceId: m.serviceId ?? null,
          serviceName: svc?.service.name ?? null,
          serviceDuration: svc?.service.duration ?? 30,
          phone: null,
        };
      }),
    };

    // dedupeKey keyed on the payload (no existing entity id yet, same reasoning
    // as OptimisticService creates) — stops a double-tap from painting two temp
    // entries and firing two POSTs (two real queue entries created server-side).
    this._socketPredict.run({
      signal: this.timeline,
      apply: (t) => [...t, tempEntry],
      request: () =>
        walkInControllerStaffAddToQueue(this._http, this._apiConfig.rootUrl, {
          salonId,
          queueId,
          body: { members },
        }),
      onSuccess: () => {
        this._toast.success('Client added to queue.');
        onSuccess?.();
      },
      onError: () => this._refetchTimeline(queueId),
      destroyRef: this._destroyRef,
      dedupeKey: `QueueConsoleService.staffAddToQueue:${queueId}:${members.map((m) => `${m.memberName}:${m.serviceId ?? ''}`).join(',')}`,
    });
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

  private _refetchTimeline(queueId: string): void {
    this._toast.error('Action failed — refreshing queue');
    publicQueueControllerGetTimeline(this._http, this._apiConfig.rootUrl, { queueId })
      .pipe(retry(1), takeUntilDestroyed(this._destroyRef))
      .subscribe({ next: (res) => this.timeline.set(res.body.timeline) });
  }

  private _loadQueueStatus(salonId: string, queueId: string): void {
    publicQueueControllerGetQueue(this._http, this._apiConfig.rootUrl, { queueId })
      .pipe(
        retry(1),
        tap((res) => this.queue.set(res.body)),
        switchMap((res) =>
          staffServicesControllerGetStaffServices(this._http, this._apiConfig.rootUrl, {
            salonId,
            staffId: res.body.staffId,
          }),
        ),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe({
        next: (res) => this.staffServices.set(res.body),
        error: () => this._toast.error('Could not load queue status'),
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
