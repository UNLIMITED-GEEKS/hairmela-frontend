import {
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
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
import { publicServicesControllerFindBySalon } from '../../../api/fn/services/public-services-controller-find-by-salon';
import { publicQueueControllerGetTimeline } from '../../../api/fn/queues/public-queue-controller-get-timeline';
import { publicQueueControllerGetQueue } from '../../../api/fn/queues/public-queue-controller-get-queue';
import { walkInControllerJoinQueue } from '../../../api/fn/queues/walk-in-controller-join-queue';
import { walkInControllerLeaveQueue } from '../../../api/fn/queues/walk-in-controller-leave-queue';
import { walkInControllerAddMembersToEntry } from '../../../api/fn/queues/walk-in-controller-add-members-to-entry';
import { SalonPublicDto } from '../../../api/models/salon-public-dto';
import { SalonPublicStaffDto } from '../../../api/models/salon-public-staff-dto';
import { Service } from '../../../api/models/service';
import { Queue } from '../../../api/models/queue';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface ActiveEntry {
  queueId: string;
  entryId: string;
  salonId: string;
}

type Screen = 'landing' | 'choose-service' | 'my-position' | 'live-queue';

const ENTRY_STORAGE_KEY = 'hairmela_active_entries';

import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';

@Component({
  selector: 'app-salon-visit',
  templateUrl: './salon-visit.component.html',
  imports: [ReactiveFormsModule, SkeletonComponent],
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
  private readonly _platformId = inject(PLATFORM_ID);

  private _installPrompt: BeforeInstallPromptEvent | null = null;
  protected readonly canInstall = signal(false);

  protected readonly screen = signal<Screen>('landing');
  protected readonly loading = signal(true);
  protected readonly joining = signal(false);
  protected readonly leaving = signal(false);
  protected readonly showAddKidsModal = signal(false);
  protected readonly addingKids = signal(false);

  protected readonly salonData = signal<SalonPublicDto | null>(null);
  protected readonly services = signal<Service[]>([]);
  protected readonly queueStatus = signal<Queue['status'] | null>(null);
  protected readonly selectedStaff = signal<SalonPublicStaffDto | null>(null);
  protected readonly selectedServiceId = signal<string | null>(null);
  protected readonly timeline = signal<TimelineEntryDto[]>([]);
  protected readonly activeEntry = signal<ActiveEntry | null>(null);
  protected readonly calledVisible = signal(false);

  // Ticks every second — drives live wait time display for all rows
  private readonly _tick = signal(0);
  private _tickInterval: ReturnType<typeof setInterval> | null = null;

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


  // The SERVING member across the whole timeline (there's at most one)
  private readonly _servingMember = computed(() => {
    for (const entry of this.timeline()) {
      const m = entry.members.find((m) => m.status === 'SERVING');
      if (m) return m;
    }
    return null;
  });

  // Elapsed seconds since servedAt — recomputes every tick
  private readonly _elapsedSeconds = computed(() => {
    this._tick();
    const servedAt = this._servingMember()?.servedAt;
    if (!servedAt) return 0;
    return Math.floor((Date.now() - new Date(servedAt).getTime()) / 1000);
  });

  // Live wait minutes per entry — ticks every second
  protected readonly liveWaitMinutes = computed((): Map<string, number> => {
    this._tick();
    const elapsedMinutes = Math.floor(this._elapsedSeconds() / 60);
    const map = new Map<string, number>();
    for (const entry of this.timeline()) {
      const adjusted = Math.max(0, entry.estimatedWaitMinutes - elapsedMinutes);
      map.set(entry.entryId, adjusted);
    }
    return map;
  });

  protected readonly isCalled = computed(() => {
    const entry = this.myEntry();
    if (!entry) return false;
    return entry.members.some((m) => m.status === 'SERVING');
  });

  protected readonly partyMembers = computed(() => {
    const entry = this.myEntry();
    if (!entry) return [];
    return entry.members.filter((m) => !m.isLeader);
  });

  ngOnInit(): void {
    const storedEntries = this._loadStoredEntries();
    this._loadSalon(storedEntries);
    this._startTick();

    const queueIdFromRoute = this._route.snapshot.paramMap.get('queueId');
    if (queueIdFromRoute) {
      this.screen.set('live-queue');
    }

    if (isPlatformBrowser(this._platformId)) {
      this._patchManifestStartUrl();

      const handler = (e: Event) => {
        e.preventDefault();
        this._installPrompt = e as BeforeInstallPromptEvent;
        this.canInstall.set(true);
      };
      window.addEventListener('beforeinstallprompt', handler);
      window.addEventListener('appinstalled', () => this.canInstall.set(false));
    }
  }

  ngOnDestroy(): void {
    const staff = this.selectedStaff();
    if (staff?.queueId) this._socket.unwatchQueue(staff.queueId);
    this._stopTick();
    this._restoreManifest();
  }

  protected installApp(): void {
    if (!this._installPrompt) return;
    this._installPrompt.prompt();
    this._installPrompt.userChoice.then(() => {
      this._installPrompt = null;
      this.canInstall.set(false);
    });
  }

  private _patchManifestStartUrl(): void {
    const slug = this._slug;
    const startUrl = slug ? `/s/${slug}` : '/';
    const manifestEl = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!manifestEl) return;

    fetch(manifestEl.href)
      .then((r) => r.json())
      .then((manifest: Record<string, unknown>) => {
        const patched = { ...manifest, start_url: startUrl, scope: '/' };
        const blob = new Blob([JSON.stringify(patched)], { type: 'application/manifest+json' });
        const url = URL.createObjectURL(blob);
        manifestEl.setAttribute('data-original-href', manifestEl.href);
        manifestEl.href = url;
      })
      .catch(() => { /* leave manifest unchanged if fetch fails */ });
  }

  private _restoreManifest(): void {
    const manifestEl = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const original = manifestEl?.getAttribute('data-original-href');
    if (manifestEl && original) {
      const blobUrl = manifestEl.href;
      manifestEl.href = original;
      manifestEl.removeAttribute('data-original-href');
      URL.revokeObjectURL(blobUrl);
    }
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
              this._watchQueue(queueIdFromRoute, storedEntries);
              this.screen.set('live-queue');
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
    publicServicesControllerFindBySalon(this._http, this._apiConfig.rootUrl, { salonId })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({ next: (res) => this.services.set(res.body) });
  }

  private _watchQueue(queueId: string, storedEntries: ActiveEntry[]): void {
    this._socket.watchQueue(queueId);

    this._loadQueueStatus(queueId);
    this._loadInitialTimeline(queueId);

    this._socket
      .queueTimeline$(queueId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((entries) => {
        this.timeline.set(entries);
        const existing = storedEntries.find((e) => e.queueId === queueId);
        if (existing) {
          const myTimelineEntry = entries.find((e) => e.entryId === existing.entryId);
          if (myTimelineEntry) {
            this.activeEntry.set(existing);
            if (this.screen() === 'choose-service') {
              this.screen.set('my-position');
            }
            if (myTimelineEntry.members.some((m) => m.status === 'SERVING')) {
              this.calledVisible.set(true);
              setTimeout(() => this.calledVisible.set(false), 5000);
            }
          } else {
            // Entry not in timeline — stale localStorage (different account or entry completed)
            this._removeStoredEntry(queueId);
            this.activeEntry.set(null);
            if (this.screen() === 'live-queue' || this.screen() === 'my-position') {
              this.screen.set('choose-service');
            }
          }
        }
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

  protected selectBarber(staff: SalonPublicStaffDto): void {
    if (!staff.queueId) return;

    if (!this._currentUser.user()) {
      this._toast.info('You must be logged in to join the queue.');
      const returnUrl = this._router.url;
      this._router.navigate(['/register'], { queryParams: { returnUrl } });
      return;
    }

    this.selectedStaff.set(staff);
    const salon = this.salon();
    const storedEntries = this._loadStoredEntries();
    if (salon) {
      this._watchQueue(staff.queueId, storedEntries);
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

    this.joining.set(true);
    walkInControllerJoinQueue(this._http, this._apiConfig.rootUrl, {
      salonId: salon.id,
      queueId: staff.queueId,
      body: { members: [{ memberName: leaderName, serviceId: this.selectedServiceId() ?? undefined }] },
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
          const body = (err as { error?: unknown })?.error;
          if (isApiError(body) && body.code === ErrorCodes.QUEUE_NOT_OPEN) {
            this._toast.info('Queue is not open right now.');
            this.queueStatus.set('CLOSED');
          }
        },
      });
  }

  protected addKids(): void {
    const entry = this.activeEntry();
    const salon = this.salon();
    const staff = this.selectedStaff();
    if (!entry || !salon || !staff?.queueId || this.addingKids()) return;

    const kidsValue = this.extraMembers.value as { name: string; serviceId: string }[];
    const validKids = kidsValue.filter((k) => k.name?.trim());
    if (validKids.length === 0) {
      this.closeAddKidsModal();
      return;
    }

    this.addingKids.set(true);
    walkInControllerAddMembersToEntry(this._http, this._apiConfig.rootUrl, {
      salonId: salon.id,
      queueId: entry.queueId,
      entryId: entry.entryId,
      body: {
        members: validKids.map((k) => ({
          memberName: k.name.trim(),
          serviceId: k.serviceId || undefined,
        })),
      },
    })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: () => {
          this.addingKids.set(false);
          this.extraMembers.clear();
          this.closeAddKidsModal();
          this._toast.success('Kids added to your queue entry.');
        },
        error: (err) => {
          this.addingKids.set(false);
          const body = (err as { error?: unknown })?.error;
          if (isApiError(body) && body.code === ErrorCodes.PARTY_TOO_LARGE) {
            this._toast.error('Party size exceeds the maximum allowed.');
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
          this._removeStoredEntry(entry.queueId);
          this.activeEntry.set(null);
          this.screen.set('landing');
          this._toast.success('You have left the queue.');
        },
        error: () => this.leaving.set(false),
      });
  }

  protected openAddKidsModal(): void {
    this.showAddKidsModal.set(true);
    if (this.extraMembers.length === 0) {
      this.extraMembers.push(this._buildMemberGroup());
    }
  }

  protected closeAddKidsModal(): void {
    this.showAddKidsModal.set(false);
  }

  protected addPartyMember(): void {
    if (this.extraMembers.length >= this.maxPartySize() - 1) return;
    this.extraMembers.push(this._buildMemberGroup());
  }

  protected removePartyMember(i: number): void {
    this.extraMembers.removeAt(i);
    if (this.extraMembers.length === 0) {
      this.showAddKidsModal.set(false);
    }
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

  protected liveWait(entryId: string): string {
    return this.formatWait(this.liveWaitMinutes().get(entryId) ?? 0);
  }

  protected goToLiveQueue(): void {
    const staff = this.selectedStaff();
    if (!staff?.queueId) return;
    this._router.navigate(['q', staff.queueId], { relativeTo: this._route.parent });
    this.screen.set('live-queue');
  }

  protected goBack(): void {
    switch (this.screen()) {
      case 'choose-service':
        this.screen.set('landing');
        break;
      case 'my-position':
        this.screen.set('landing');
        break;
      case 'live-queue':
        this.screen.set(this.activeEntry() ? 'my-position' : 'landing');
        break;
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
