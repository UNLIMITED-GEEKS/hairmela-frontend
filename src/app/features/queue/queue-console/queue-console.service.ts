import { Injectable, DestroyRef, inject, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { filter, switchMap, tap } from 'rxjs';
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
import { staffServicesControllerGetStaffServices } from '../../../api/fn/services/staff-services-controller-get-staff-services';
import { StaffService } from '../../../api/models/staff-service';

@Injectable()
export class QueueConsoleService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _socket = inject(QueueSocketService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _toast = inject(ToastService);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _tick = signal(0);
  private _tickInterval: ReturnType<typeof setInterval> | null = null;

  readonly queue = signal<Queue | null>(null);
  readonly timeline = signal<TimelineEntryDto[]>([]);
  readonly staffServices = signal<StaffService[]>([]);
  readonly loading = signal(true);
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
        if (member.status === 'SERVED') { map.set(member.memberId, 0); continue; }
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
    this._loadQueueStatus(salonId, queueId);
    this._socket.queueTimeline$(queueId).pipe(
      takeUntilDestroyed(this._destroyRef),
    ).subscribe((entries) => { this.timeline.set(entries); this.loading.set(false); });
    this._socket.watchQueueAsStaff(queueId);
    publicQueueControllerGetTimeline(this._http, this._apiConfig.rootUrl, { queueId })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({ next: (res) => { this.timeline.set(res.body); this.loading.set(false); } });
    this._startTick();
  }

  destroy(queueId: string): void {
    this._socket.unwatchQueue(queueId);
    this._stopTick();
  }

  setStatus(salonId: string, queueId: string, status: 'OPEN' | 'PAUSED' | 'CLOSED'): void {
    if (this.acting()) return;
    this.acting.set(true);
    queueManagementControllerSetStatus(this._http, this._apiConfig.rootUrl, {
      salonId, queueId, body: { status },
    }).pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: (res) => { this.queue.set(res.body); this.acting.set(false); },
      error: () => this.acting.set(false),
    });
  }

  callNext(salonId: string, queueId: string, onResolveNeeded: () => void): void {
    if (this.acting()) return;
    this.acting.set(true);
    queueManagementControllerCallNext(this._http, this._apiConfig.rootUrl, { salonId, queueId })
      .pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
        next: () => this.acting.set(false),
        error: (err: unknown) => {
          this.acting.set(false);
          const body = (err as { error?: unknown })?.error;
          if (isApiError(body) && (
            body.code === ErrorCodes.ENTRY_ALREADY_SERVING ||
            body.code === ErrorCodes.ENTRY_NOT_WAITING
          )) { onResolveNeeded(); } else {
            this._toast.info('Resolve the current client first before calling the next one.');
          }
        },
      });
  }

  endSession(salonId: string, queueId: string): void {
    const member = this.servingMember();
    const entry = this.servingEntry();
    if (!member || !entry || this.acting()) return;
    this._confirmDialog.open({
      title: 'End session?',
      message: `Mark ${member.memberName} as complete?`,
      confirmLabel: 'End Session',
      danger: false,
    }).pipe(
      filter((ok) => ok),
      tap(() => this.acting.set(true)),
      switchMap(() => queueManagementControllerCompleteMember(this._http, this._apiConfig.rootUrl, {
        salonId, queueId, entryId: entry.entryId, memberId: member.memberId,
      })),
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({ next: () => this.acting.set(false), error: () => this.acting.set(false) });
  }


  endAllMembers(salonId: string, queueId: string): void {
    const entry = this.servingEntry();
    if (!entry || this.acting()) return;
    this.acting.set(true);
    queueManagementControllerCompleteAllMembers(this._http, this._apiConfig.rootUrl, {
      salonId, queueId, entryId: entry.entryId,
    }).pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: () => this.acting.set(false),
      error: () => this.acting.set(false),
    });
  }

  completeMember(salonId: string, queueId: string, entryId: string, memberId: string): void {
    if (this.acting()) return;
    this.acting.set(true);
    queueManagementControllerCompleteMember(this._http, this._apiConfig.rootUrl, { salonId, queueId, entryId, memberId })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({ next: () => this.acting.set(false), error: () => this.acting.set(false) });
  }

  noShow(salonId: string, queueId: string, entryId: string): void {
    if (this.acting()) return;
    this._confirmDialog.open({
      title: 'Mark as no-show?',
      message: 'This client will be removed from the queue.',
      confirmLabel: 'No-show',
      danger: true,
    }).pipe(
      filter((ok) => ok),
      tap(() => this.acting.set(true)),
      switchMap(() => queueManagementControllerMarkNoShow(this._http, this._apiConfig.rootUrl, { salonId, queueId, entryId })),
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({ next: () => this.acting.set(false), error: () => this.acting.set(false) });
  }

  cancelEntry(salonId: string, queueId: string, entryId: string): void {
    if (this.acting()) return;
    this._confirmDialog
      .open({
        title: 'Cancel entry?',
        message: 'Remove this client from the queue entirely.',
        confirmLabel: 'Yes',
        danger: true,
      })
      .pipe(
        filter((ok) => ok),
        tap(() => this.acting.set(true)),
        switchMap(() =>
          queueManagementControllerCancelEntry(this._http, this._apiConfig.rootUrl, {
            salonId,
            queueId,
            entryId,
          }),
        ),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe({ next: () => this.acting.set(false), error: () => this.acting.set(false) });
  }

  serveMember(salonId: string, queueId: string, entryId: string, memberId: string): void {
    if (this.acting()) return;
    this.acting.set(true);
    queueManagementControllerServeMember(this._http, this._apiConfig.rootUrl, { salonId, queueId, entryId, memberId })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({ next: () => this.acting.set(false), error: () => this.acting.set(false) });
  }

  extendMember(salonId: string, queueId: string, entryId: string, memberId: string, body: ExtendMemberDto): void {
    if (this.acting()) return;
    this.acting.set(true);
    queueManagementControllerExtendMember(this._http, this._apiConfig.rootUrl, { salonId, queueId, entryId, memberId, body })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({ next: () => this.acting.set(false), error: () => this.acting.set(false) });
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

  private _loadQueueStatus(salonId: string, queueId: string): void {
    publicQueueControllerGetQueue(this._http, this._apiConfig.rootUrl, { queueId })
      .pipe(
        tap((res) => this.queue.set(res.body)),
        switchMap((res) => staffServicesControllerGetStaffServices(this._http, this._apiConfig.rootUrl, {
          salonId,
          staffId: res.body.staffId,
        })),
        takeUntilDestroyed(this._destroyRef),
      ).subscribe({ next: (res) => this.staffServices.set(res.body) });
  }

  private _startTick(): void {
    this._tickInterval = setInterval(() => this._tick.update((n) => n + 1), 1000);
  }

  private _stopTick(): void {
    if (this._tickInterval) { clearInterval(this._tickInterval); this._tickInterval = null; }
  }
}
