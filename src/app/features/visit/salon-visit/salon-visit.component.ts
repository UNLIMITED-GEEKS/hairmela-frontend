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
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { filter, switchMap, tap } from 'rxjs';
import { ApiConfiguration } from '../../../api/api-configuration';
import { QueueSocketService } from '../../../core/socket/queue-socket.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { ToastService } from '../../../core/toast/toast.service';
import { ErrorCodes } from '../../../core/errors/error-codes';
import { isApiError } from '../../../core/errors/api-error.types';
import { TimelineEntryDto } from '../../../core/socket/socket.types';
import { publicSalonsControllerFindBySlug } from '../../../api/fn/salons/public-salons-controller-find-by-slug';
import { publicQueueControllerGetTimeline } from '../../../api/fn/queues/public-queue-controller-get-timeline';
import { walkInControllerJoinQueue } from '../../../api/fn/queues/walk-in-controller-join-queue';
import { SalonPublicDto } from '../../../api/models/salon-public-dto';
import { SalonPublicStaffDto } from '../../../api/models/salon-public-staff-dto';
import { Service } from '../../../api/models/service';
import { Queue } from '../../../api/models/queue';

interface ActiveEntry {
  queueId: string;
  entryId: string;
  salonId: string;
}

type Screen = 'landing' | 'choose-service' | 'my-position' | 'live-queue';

const ENTRY_STORAGE_KEY = 'hairmela_active_entries';

@Component({
  selector: 'app-salon-visit',
  templateUrl: './salon-visit.component.html',
  imports: [ReactiveFormsModule],
})
export class SalonVisitComponent implements OnInit, OnDestroy {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _socket = inject(QueueSocketService);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _toast = inject(ToastService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _fb = inject(FormBuilder);

  protected readonly screen = signal<Screen>('landing');
  protected readonly loading = signal(true);
  protected readonly joining = signal(false);
  protected readonly leaving = signal(false);
  protected readonly showAddParty = signal(false);

  protected readonly salonData = signal<SalonPublicDto | null>(null);
  protected readonly services = signal<Service[]>([]);
  protected readonly queueStatus = signal<Queue['status'] | null>(null);
  protected readonly selectedStaff = signal<SalonPublicStaffDto | null>(null);
  protected readonly selectedServiceId = signal<string | null>(null);
  protected readonly timeline = signal<TimelineEntryDto[]>([]);
  protected readonly activeEntry = signal<ActiveEntry | null>(null);
  protected readonly calledVisible = signal(false);

  protected readonly joinForm = this._fb.group({
    extraMembers: this._fb.array<ReturnType<typeof this._buildMemberGroup>>([]),
  });

  protected get extraMembers(): FormArray {
    return this.joinForm.get('extraMembers') as FormArray;
  }

  private get _slug(): string {
    return this._route.snapshot.paramMap.get('slug') ?? '';
  }

  protected readonly salon = computed(() => this.salonData()?.salon ?? null);
  protected readonly staffList = computed(() => this.salonData()?.staff ?? []);

  protected readonly maxPartySize = computed(() => {
    const settings = this.salon()?.settings as { maxPartySize?: number } | undefined;
    return settings?.maxPartySize ?? 5;
  });

  protected readonly myEntry = computed(() => {
    const entry = this.activeEntry();
    if (!entry) return null;
    return this.timeline().find((e) => e.entryId === entry.entryId) ?? null;
  });

  protected readonly waitingEntries = computed(() =>
    this.timeline().filter((e) =>
      e.members.some((m) => m.status === 'WAITING' || m.status === 'SERVING'),
    ),
  );

  protected readonly isCalled = computed(() => {
    const entry = this.myEntry();
    if (!entry) return false;
    return entry.members.some((m) => m.status === 'SERVING');
  });

  ngOnInit(): void {
    const storedEntries = this._loadStoredEntries();
    this._loadSalon(storedEntries);

    const queueIdFromRoute = this._route.snapshot.paramMap.get('queueId');
    if (queueIdFromRoute) {
      this.screen.set('live-queue');
    }
  }

  ngOnDestroy(): void {
    const staff = this.selectedStaff();
    if (staff?.queueId) this._socket.unwatchQueue(staff.queueId);
  }

  private _loadSalon(storedEntries: ActiveEntry[]): void {
    publicSalonsControllerFindBySlug(this._http, this._apiConfig.rootUrl, {
      slug: this._slug,
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          this.salonData.set(res.body);
          this.loading.set(false);

          const salonId = res.body.salon.id;
          this._loadServices(salonId);

          const queueIdFromRoute = this._route.snapshot.paramMap.get('queueId');
          if (queueIdFromRoute) {
            const staff = res.body.staff.find((s) => s.queueId === queueIdFromRoute);
            if (staff) {
              this.selectedStaff.set(staff);
              this._watchQueue(queueIdFromRoute, salonId, storedEntries);
            }
          }
        },
        error: () => {
          this.loading.set(false);
          this._toast.error('Salon not found');
          this._router.navigate(['/dashboard']);
        },
      });
  }

  private _loadServices(salonId: string): void {
    this._http
      .get<Service[]>(`${this._apiConfig.rootUrl}/v1/salons/${salonId}/services`)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({ next: (services) => this.services.set(services) });
  }

  private _watchQueue(queueId: string, salonId: string, storedEntries: ActiveEntry[]): void {
    this._socket.watchQueue(queueId);

    this._loadQueueStatus(salonId, queueId);
    this._loadInitialTimeline(queueId);

    this._socket
      .queueTimeline$(queueId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((entries) => {
        this.timeline.set(entries);
        const existing = storedEntries.find((e) => e.queueId === queueId);
        if (existing) {
          this.activeEntry.set(existing);
          const myTimelineEntry = entries.find((e) => e.entryId === existing.entryId);
          if (myTimelineEntry?.members.some((m) => m.status === 'SERVING')) {
            this.calledVisible.set(true);
            setTimeout(() => this.calledVisible.set(false), 5000);
          }
        }
      });
  }

  private _loadQueueStatus(salonId: string, queueId: string): void {
    this._http
      .get<Queue>(`${this._apiConfig.rootUrl}/v1/salons/${salonId}/queues/${queueId}`)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({ next: (q) => this.queueStatus.set(q.status) });
  }

  private _loadInitialTimeline(queueId: string): void {
    publicQueueControllerGetTimeline(this._http, this._apiConfig.rootUrl, { queueId })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({ next: (res) => this.timeline.set(res.body) });
  }

  protected selectBarber(staff: SalonPublicStaffDto): void {
    if (!staff.queueId) return;
    this.selectedStaff.set(staff);
    const salon = this.salon();
    if (salon) {
      this._watchQueue(staff.queueId, salon.id, this._loadStoredEntries());
    }
    this.screen.set('choose-service');
  }

  protected selectService(serviceId: string): void {
    this.selectedServiceId.set(serviceId);
  }

  protected joinQueue(): void {
    const staff = this.selectedStaff();
    const salon = this.salon();
    if (!staff?.queueId || !salon || this.joining()) return;

    if (this.queueStatus() === 'CLOSED') {
      this._toast.info('This queue is currently closed.');
      return;
    }

    const user = this._currentUser.user();
    const leaderName = user ? `${user.firstName}` : 'Me';
    const extraMembersValue = this.extraMembers.value as { name: string; serviceId: string }[];

    const members = [
      { memberName: leaderName, serviceId: this.selectedServiceId() ?? undefined },
      ...extraMembersValue.map((m) => ({
        memberName: m.name,
        serviceId: m.serviceId || undefined,
      })),
    ];

    this.joining.set(true);
    walkInControllerJoinQueue(this._http, this._apiConfig.rootUrl, {
      salonId: salon.id,
      queueId: staff.queueId,
      body: { members },
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          const entry: ActiveEntry = {
            queueId: staff.queueId!,
            entryId: res.body.id,
            salonId: salon.id,
          };
          this.activeEntry.set(entry);
          this._saveEntry(entry);
          this.joining.set(false);
          this.screen.set('my-position');
        },
        error: (err) => {
          this.joining.set(false);
          if (isApiError(err) && err.code === ErrorCodes.QUEUE_NOT_OPEN) {
            this._toast.info('Queue is not open right now.');
            this.queueStatus.set('CLOSED');
          } else if (isApiError(err) && err.code === ErrorCodes.PARTY_TOO_LARGE) {
            this._toast.error(`Party is too large. Max party size: ${this.maxPartySize()}`);
          }
        },
      });
  }

  protected leaveQueue(): void {
    const entry = this.activeEntry();
    const salon = this.salon();
    if (!entry || !salon || this.leaving()) return;

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
        switchMap(() =>
          this._http.delete(
            `${this._apiConfig.rootUrl}/v1/salons/${entry.salonId}/queues/${entry.queueId}/walk-in/${entry.entryId}`,
          ),
        ),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe({
        next: () => {
          this.leaving.set(false);
          this._removeStoredEntry(entry.queueId);
          this.activeEntry.set(null);
          this.screen.set('landing');
          this._toast.success('You have left the queue.');
        },
        error: () => this.leaving.set(false),
      });
  }

  protected addPartyMember(): void {
    if (this.extraMembers.length >= this.maxPartySize() - 1) return;
    this.extraMembers.push(this._buildMemberGroup());
    this.showAddParty.set(true);
  }

  protected removePartyMember(i: number): void {
    this.extraMembers.removeAt(i);
  }

  private _buildMemberGroup() {
    return this._fb.group({
      name: ['', Validators.required],
      serviceId: [''],
    });
  }

  protected staffServices(staff: SalonPublicStaffDto): Service[] {
    return this.services().filter((s) => staff.serviceIds.includes(s.id));
  }

  protected isQueueOpen(): boolean {
    return this.queueStatus() === 'OPEN' || this.queueStatus() === 'PAUSED';
  }

  protected formatWait(minutes: number): string {
    if (minutes < 1) return '< 1m';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  protected goToLiveQueue(): void {
    const staff = this.selectedStaff();
    if (!staff?.queueId) return;
    this._router.navigate(['q', staff.queueId], { relativeTo: this._route.parent });
    this.screen.set('live-queue');
  }

  protected goBack(): void {
    switch (this.screen()) {
      case 'choose-service': this.screen.set('landing'); break;
      case 'my-position': this.screen.set('choose-service'); break;
      case 'live-queue': this.screen.set('my-position'); break;
    }
  }

  private _loadStoredEntries(): ActiveEntry[] {
    try {
      const raw = localStorage.getItem(ENTRY_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as ActiveEntry[]) : [];
    } catch {
      return [];
    }
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
