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
import { SalonPublicDto } from '../../../api/models/salon-public-dto';
import { SalonPublicStaffDto } from '../../../api/models/salon-public-staff-dto';
import { Service } from '../../../api/models/service';
import { Queue } from '../../../api/models/queue';
import { JoinQueueDto } from '../../../api/models/join-queue-dto';
import { publicSalonsControllerFindBySlug } from '../../../api/fn/salons/public-salons-controller-find-by-slug';
import { publicServicesControllerFindBySalon } from '../../../api/fn/services/public-services-controller-find-by-salon';
import { publicQueueControllerGetTimeline } from '../../../api/fn/queues/public-queue-controller-get-timeline';
import { publicQueueControllerGetQueue } from '../../../api/fn/queues/public-queue-controller-get-queue';
import { walkInControllerJoinQueue } from '../../../api/fn/queues/walk-in-controller-join-queue';
import { walkInControllerLeaveQueue } from '../../../api/fn/queues/walk-in-controller-leave-queue';

export interface ActiveEntry {
  queueId: string;
  entryId: string;
  salonId: string;
}

const ENTRY_STORAGE_KEY = 'hairmela_active_entries';

@Injectable()
export class SalonVisitService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _socket = inject(QueueSocketService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _toast = inject(ToastService);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _tick = signal(0);
  private _tickInterval: ReturnType<typeof setInterval> | null = null;

  readonly salonData = signal<SalonPublicDto | null>(null);
  readonly services = signal<Service[]>([]);
  readonly timeline = signal<TimelineEntryDto[]>([]);
  readonly queueStatus = signal<Queue['status'] | null>(null);
  readonly activeEntry = signal<ActiveEntry | null>(null);
  readonly loading = signal(true);
  readonly joining = signal(false);
  readonly leaving = signal(false);
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

  readonly isCalled = computed(() => {
    const entry = this.myEntry();
    if (!entry) return false;
    return entry.members.some((m) => m.status === 'SERVING');
  });

  init(slug: string, queueIdFromRoute: string | null): void {
    const storedEntries = this._loadStoredEntries();
    this._loadSalon(slug, storedEntries, queueIdFromRoute);
    this._startTick();
  }

  destroy(selectedStaff: SalonPublicStaffDto | null): void {
    if (selectedStaff?.queueId) this._socket.unwatchQueue(selectedStaff.queueId);
    this._stopTick();
  }

  watchQueue(queueId: string): void {
    const storedEntries = this._loadStoredEntries();
    this._socket.watchQueue(queueId);
    this._loadQueueStatus(queueId);
    this._loadInitialTimeline(queueId);
    this._socket.queueTimeline$(queueId).pipe(
      takeUntilDestroyed(this._destroyRef),
    ).subscribe((entries) => {
      this.timeline.set(entries);
      const existing = storedEntries.find((e) => e.queueId === queueId);
      if (existing) {
        const myTimelineEntry = entries.find((e) => e.entryId === existing.entryId);
        if (myTimelineEntry) {
          this.activeEntry.set(existing);
          if (myTimelineEntry.members.some((m) => m.status === 'SERVING')) {
            this.calledVisible.set(true);
            setTimeout(() => this.calledVisible.set(false), 5000);
          }
        } else {
          this._removeStoredEntry(queueId);
          this.activeEntry.set(null);
        }
      }
    });
  }

  joinQueue(salonId: string, queueId: string, body: JoinQueueDto, onSuccess: (entryId: string) => void): void {
    if (this.joining()) return;
    this.joining.set(true);
    walkInControllerJoinQueue(this._http, this._apiConfig.rootUrl, { salonId, queueId, body })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          const entry: ActiveEntry = { queueId, entryId: res.body.id, salonId };
          this.activeEntry.set(entry);
          this._saveEntry(entry);
          this.joining.set(false);
          onSuccess(res.body.id);
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
      switchMap(() => walkInControllerLeaveQueue(this._http, this._apiConfig.rootUrl, {
        salonId: entry.salonId, queueId: entry.queueId, entryId: entry.entryId,
      })),
      takeUntilDestroyed(this._destroyRef),
    ).subscribe({
      next: () => {
        this.leaving.set(false);
        this._removeStoredEntry(entry.queueId);
        this.activeEntry.set(null);
        this._toast.success('You have left the queue.');
        onSuccess();
      },
      error: () => this.leaving.set(false),
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

  loadStoredEntries(): ActiveEntry[] { return this._loadStoredEntries(); }

  private _loadSalon(slug: string, storedEntries: ActiveEntry[], queueIdFromRoute: string | null): void {
    publicSalonsControllerFindBySlug(this._http, this._apiConfig.rootUrl, { slug })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          this.salonData.set(res.body);
          this.loading.set(false);
          publicServicesControllerFindBySalon(this._http, this._apiConfig.rootUrl, { salonId: res.body.salon.id })
            .pipe(takeUntilDestroyed(this._destroyRef))
            .subscribe({ next: (svc) => this.services.set(svc.body) });
          if (queueIdFromRoute) {
            const staff = res.body.staff.find((s) => s.queueId === queueIdFromRoute);
            if (staff) this.watchQueue(queueIdFromRoute);
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
      .subscribe({ next: (res) => this.timeline.set(res.body) });
  }

  private _startTick(): void {
    this._tickInterval = setInterval(() => this._tick.update((n) => n + 1), 1000);
  }

  private _stopTick(): void {
    if (this._tickInterval) { clearInterval(this._tickInterval); this._tickInterval = null; }
  }

  private _loadStoredEntries(): ActiveEntry[] {
    try {
      const raw = localStorage.getItem(ENTRY_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as ActiveEntry[]) : [];
    } catch { return []; }
  }

  private _saveEntry(entry: ActiveEntry): void {
    const entries = this._loadStoredEntries().filter((e) => e.queueId !== entry.queueId);
    entries.push(entry);
    localStorage.setItem(ENTRY_STORAGE_KEY, JSON.stringify(entries));
  }

  private _removeStoredEntry(queueId: string): void {
    const entries = this._loadStoredEntries().filter((e) => e.queueId !== queueId);
    localStorage.setItem(ENTRY_STORAGE_KEY, JSON.stringify(entries));
  }
}
