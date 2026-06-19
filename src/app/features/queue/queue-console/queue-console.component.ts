import {
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { filter, switchMap, tap } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { QueueSocketService } from '../../../core/socket/queue-socket.service';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../../core/toast/toast.service';
import { ErrorCodes } from '../../../core/errors/error-codes';
import { isApiError } from '../../../core/errors/api-error.types';
import { TimelineEntryDto } from '../../../core/socket/socket.types';
import { queueManagementControllerCallNext } from '../../../api/fn/queues/queue-management-controller-call-next';
import { queueManagementControllerSetStatus } from '../../../api/fn/queues/queue-management-controller-set-status';
import { queueManagementControllerServeMember } from '../../../api/fn/queues/queue-management-controller-serve-member';
import { queueManagementControllerCompleteMember } from '../../../api/fn/queues/queue-management-controller-complete-member';
import { queueManagementControllerExtendMember } from '../../../api/fn/queues/queue-management-controller-extend-member';
import { queueManagementControllerMarkNoShow } from '../../../api/fn/queues/queue-management-controller-mark-no-show';
import { queueManagementControllerCancelEntry } from '../../../api/fn/queues/queue-management-controller-cancel-entry';
import { publicQueueControllerGetTimeline } from '../../../api/fn/queues/public-queue-controller-get-timeline';
import { publicQueueControllerGetQueue } from '../../../api/fn/queues/public-queue-controller-get-queue';
import { walkInControllerStaffAddToQueue } from '../../../api/fn/queues/walk-in-controller-staff-add-to-queue';
import { Queue } from '../../../api/models/queue';

import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';

@Component({
  selector: 'app-queue-console',
  templateUrl: './queue-console.component.html',
  imports: [SkeletonComponent, ReactiveFormsModule],
})
export class QueueConsoleComponent implements OnInit, OnDestroy {
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _socket = inject(QueueSocketService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _toast = inject(ToastService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _fb = inject(FormBuilder);

  protected readonly activePanel = signal<'current' | 'queue'>('current');
  protected readonly loading = signal(true);
  protected readonly acting = signal(false);
  protected readonly showAddQueueModal = signal(false);
  protected readonly addingToQueue = signal(false);
  protected readonly showEndPartyModal = signal(false);
  protected readonly showExtendModal = signal(false);
  protected readonly extendTargetEntryId = signal<string | null>(null);
  protected readonly extendTargetMemberId = signal<string | null>(null);
  protected readonly extendMinutes = signal<number | null>(null);

  protected readonly addQueueForm = this._fb.group({
    members: this._fb.array([this._buildMemberRow()]),
  });

  protected get addQueueMembers(): FormArray {
    return this.addQueueForm.get('members') as FormArray;
  }
  protected readonly queue = signal<Queue | null>(null);
  protected readonly timeline = signal<TimelineEntryDto[]>([]);
  protected readonly timerDisplay = signal('00:00');
  protected readonly statusOptions: Array<'OPEN' | 'PAUSED' | 'CLOSED'> = ['OPEN', 'PAUSED', 'CLOSED'];

  // Ticks every second — drives live wait time display for all rows
  private readonly _tick = signal(0);
  private _tickInterval: ReturnType<typeof setInterval> | null = null;

  protected get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  protected get _queueId(): string {
    return this._route.snapshot.paramMap.get('queueId') ?? '';
  }

  protected readonly servingEntry = computed(() =>
    this.timeline().find((e) => e.members.some((m) => m.status === 'SERVING')),
  );

  protected readonly servingMember = computed(() =>
    this.servingEntry()?.members.find((m) => m.status === 'SERVING'),
  );

  protected readonly waitingEntries = computed(() =>
    this.timeline().filter((e) => e.members.every((m) => m.status === 'WAITING')),
  );

  // All unfinished members in the serving entry except the primary SERVING one
  protected readonly servingPartyMembers = computed(() => {
    const entry = this.servingEntry();
    if (!entry) return [];
    return entry.members.filter((m) => m.status === 'WAITING' || m.status === 'SERVING');
  });

  // Queue list for right panel: serving entry first (if any), then all waiting entries
  protected readonly queueListEntries = computed(() => {
    const serving = this.servingEntry();
    const waiting = this.waitingEntries();
    return serving ? [serving, ...waiting] : waiting;
  });

  protected readonly queueStatus = computed(() => this.queue()?.status ?? 'CLOSED');

  // Elapsed seconds since servedAt — derived from the tick signal so it updates every second
  private readonly _elapsedSeconds = computed(() => {
    this._tick(); // subscribe to tick so this recomputes every second
    const servedAt = this.servingMember()?.servedAt;
    if (!servedAt) return 0;
    return Math.floor((Date.now() - new Date(servedAt).getTime()) / 1000);
  });

  // Barber stopwatch — derived from servedAt, accurate on reload
  protected readonly timerFromServedAt = computed(() => {
    const s = this._elapsedSeconds();
    const m = String(Math.floor(s / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${m}:${sec}`;
  });

  // Live wait minutes for every entry — ticks every second
  protected readonly liveWaitMinutes = computed((): Map<string, number> => {
    this._tick(); // subscribe to tick
    const elapsedMinutes = Math.floor(this._elapsedSeconds() / 60);
    const map = new Map<string, number>();
    for (const entry of this.timeline()) {
      const adjusted = Math.max(0, entry.estimatedWaitMinutes - elapsedMinutes);
      map.set(entry.entryId, adjusted);
    }
    return map;
  });

  protected readonly estimatedFinishTime = computed(() => {
    const member = this.servingMember();
    if (!member?.servedAt) return null;
    const finishMs = new Date(member.servedAt).getTime() + member.serviceDuration * 60 * 1000;
    return new Date(finishMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  });

  ngOnInit(): void {
    this._loadInitialTimeline();
    this._socket.watchQueueAsStaff(this._queueId);
    this._socket
      .queueTimeline$(this._queueId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((entries) => this.timeline.set(entries));

    this._loadQueueStatus();
    this._startTick();
  }

  ngOnDestroy(): void {
    this._socket.unwatchQueue(this._queueId);
    this._stopTick();
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

  private _loadInitialTimeline(): void {
    publicQueueControllerGetTimeline(this._http, this._apiConfig.rootUrl, {
      queueId: this._queueId,
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          this.timeline.set(res.body);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  private _refreshTimeline(): void {
    publicQueueControllerGetTimeline(this._http, this._apiConfig.rootUrl, {
      queueId: this._queueId,
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({ next: (res) => this.timeline.set(res.body) });
  }

  private _loadQueueStatus(): void {
    publicQueueControllerGetQueue(this._http, this._apiConfig.rootUrl, {
      queueId: this._queueId,
    }).pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: (res) => this.queue.set(res.body),
    });
  }

  protected setStatus(status: 'OPEN' | 'PAUSED' | 'CLOSED'): void {
    if (this.acting()) return;
    this.acting.set(true);
    queueManagementControllerSetStatus(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
      queueId: this._queueId,
      body: { status },
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          this.queue.set(res.body);
          this.acting.set(false);
        },
        error: () => this.acting.set(false),
      });
  }

  protected callNext(): void {
    if (this.acting()) return;
    this.acting.set(true);
    queueManagementControllerCallNext(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
      queueId: this._queueId,
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: () => {
          this.acting.set(false);
          this.activePanel.set('current');
          this._refreshTimeline();
        },
        error: (err: unknown) => {
          this.acting.set(false);
          const body = (err as { error?: unknown })?.error;
          if (isApiError(body) && (
            body.code === ErrorCodes.ENTRY_ALREADY_SERVING ||
            body.code === ErrorCodes.ENTRY_NOT_WAITING
          )) {
            this._toast.info('Resolve the current client first before calling the next one.');
          }
        },
      });
  }

  protected endSession(): void {
    const entry = this.servingEntry();
    if (!entry || this.acting()) return;

    const unfinished = entry.members.filter(
      (m) => m.status === 'WAITING' || m.status === 'SERVING',
    );

    if (unfinished.length > 1) {
      // Party has multiple unfinished members — ask barber what to do
      this.showEndPartyModal.set(true);
      return;
    }

    // Single member — complete directly
    const member = unfinished[0];
    if (!member) return;
    this.acting.set(true);
    queueManagementControllerCompleteMember(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
      queueId: this._queueId,
      entryId: entry.entryId,
      memberId: member.memberId,
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: () => { this.acting.set(false); this._refreshTimeline(); },
        error: () => this.acting.set(false),
      });
  }

  protected endAllMembers(): void {
    const entry = this.servingEntry();
    if (!entry || this.acting()) return;
    this.showEndPartyModal.set(false);

    const unfinished = entry.members.filter(
      (m) => m.status === 'WAITING' || m.status === 'SERVING',
    );

    // Complete them sequentially — the last one closes the entry server-side
    this.acting.set(true);
    let chain$ = queueManagementControllerCompleteMember(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
      queueId: this._queueId,
      entryId: entry.entryId,
      memberId: unfinished[0].memberId,
    });

    for (let i = 1; i < unfinished.length; i++) {
      const memberId = unfinished[i].memberId;
      chain$ = chain$.pipe(
        switchMap(() =>
          queueManagementControllerCompleteMember(this._http, this._apiConfig.rootUrl, {
            salonId: this._salonId,
            queueId: this._queueId,
            entryId: entry.entryId,
            memberId,
          }),
        ),
      ) as typeof chain$;
    }

    chain$.pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: () => { this.acting.set(false); this._refreshTimeline(); },
      error: () => this.acting.set(false),
    });
  }

  protected completeMember(entryId: string, memberId: string): void {
    if (this.acting()) return;
    this.acting.set(true);
    queueManagementControllerCompleteMember(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
      queueId: this._queueId,
      entryId,
      memberId,
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: () => { this.acting.set(false); this._refreshTimeline(); },
        error: () => this.acting.set(false),
      });
  }

  protected serveMember(entryId: string, memberId: string): void {
    if (this.acting()) return;
    this.acting.set(true);
    queueManagementControllerServeMember(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
      queueId: this._queueId,
      entryId,
      memberId,
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: () => { this.acting.set(false); this._refreshTimeline(); },
        error: () => this.acting.set(false),
      });
  }

  protected openExtendModal(entryId: string, memberId: string): void {
    this.extendTargetEntryId.set(entryId);
    this.extendTargetMemberId.set(memberId);
    this.extendMinutes.set(null);
    this.showExtendModal.set(true);
  }

  protected confirmExtend(): void {
    const entryId = this.extendTargetEntryId();
    const memberId = this.extendTargetMemberId();
    const minutes = this.extendMinutes();
    if (!entryId || !memberId || !minutes || minutes < 1 || this.acting()) return;

    this.acting.set(true);
    this.showExtendModal.set(false);
    queueManagementControllerExtendMember(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
      queueId: this._queueId,
      entryId,
      memberId,
      body: { extraMinutes: minutes },
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: () => { this.acting.set(false); this._refreshTimeline(); },
        error: () => this.acting.set(false),
      });
  }

  protected noShow(entryId: string): void {
    if (this.acting()) return;
    this._confirmDialog
      .open({
        title: 'Mark as no-show?',
        message: 'This client will be removed from the queue.',
        confirmLabel: 'No-show',
        danger: true,
      })
      .pipe(
        filter((ok) => ok),
        tap(() => this.acting.set(true)),
        switchMap(() =>
          queueManagementControllerMarkNoShow(this._http, this._apiConfig.rootUrl, {
            salonId: this._salonId,
            queueId: this._queueId,
            entryId,
          }),
        ),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe({
        next: () => { this.acting.set(false); this._refreshTimeline(); },
        error: () => this.acting.set(false),
      });
  }

  protected cancelEntry(entryId: string): void {
    if (this.acting()) return;
    this._confirmDialog
      .open({
        title: 'Cancel entry?',
        message: 'Remove this client from the queue entirely.',
        confirmLabel: 'Cancel',
        danger: true,
      })
      .pipe(
        filter((ok) => ok),
        tap(() => this.acting.set(true)),
        switchMap(() =>
          queueManagementControllerCancelEntry(this._http, this._apiConfig.rootUrl, {
            salonId: this._salonId,
            queueId: this._queueId,
            entryId,
          }),
        ),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe({
        next: () => { this.acting.set(false); this._refreshTimeline(); },
        error: () => this.acting.set(false),
      });
  }

  protected formatWait(minutes: number): string {
    if (minutes < 1) return '< 1m';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  protected liveWait(entryId: string): string {
    return this.formatWait(this.liveWaitMinutes().get(entryId) ?? 0);
  }

  protected openAddQueueModal(): void {
    this.addQueueMembers.clear();
    this.addQueueMembers.push(this._buildMemberRow());
    this.showAddQueueModal.set(true);
  }

  protected closeAddQueueModal(): void {
    this.showAddQueueModal.set(false);
  }

  protected addQueueMemberRow(): void {
    this.addQueueMembers.push(this._buildMemberRow());
  }

  protected removeQueueMemberRow(i: number): void {
    this.addQueueMembers.removeAt(i);
    if (this.addQueueMembers.length === 0) {
      this.addQueueMembers.push(this._buildMemberRow());
    }
  }

  protected staffAddToQueue(): void {
    if (this.addingToQueue()) return;
    const rows = this.addQueueMembers.value as { name: string; serviceId: string }[];
    const valid = rows.filter((r) => r.name?.trim());
    if (valid.length === 0) {
      this._toast.error('Enter at least one name.');
      return;
    }
    this.addingToQueue.set(true);
    walkInControllerStaffAddToQueue(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
      queueId: this._queueId,
      body: {
        members: valid.map((r) => ({
          memberName: r.name.trim(),
          serviceId: r.serviceId || undefined,
        })),
      },
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: () => {
          this.addingToQueue.set(false);
          this.closeAddQueueModal();
          this._toast.success('Client added to queue.');
          this._refreshTimeline();
        },
        error: () => this.addingToQueue.set(false),
      });
  }

  private _buildMemberRow() {
    return this._fb.group({
      name: ['', Validators.required],
      serviceId: [''],
    });
  }
}
