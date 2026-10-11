import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterOutlet, RouterLink, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { QueueConsoleService } from '../queue-console/queue-console.service';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { ConnectionBannerComponent } from '../../../shared/components/connection-banner/connection-banner.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import {
  RouteParam,
  RouteSegment,
  RoutePath,
  RouteQueryParam,
  HowItWorksTab,
} from '../../../core/routing/route-paths';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { ToastService } from '../../../core/toast/toast.service';
import { SalonSettingsService } from '../../salons/salon-settings/salon-settings.service';
import { environment } from '../../../../environments/environment';
import { AppHeaderService } from '../../../core/routing/app-header.service';

@Component({
  selector: 'app-queue-shell',
  templateUrl: './queue-shell.component.html',
  providers: [QueueConsoleService],
  imports: [SkeletonComponent, RouterOutlet, RouterLink, ConnectionBannerComponent, IconComponent],
})
export class QueueShellComponent implements OnInit, OnDestroy {
  protected readonly console = inject(QueueConsoleService);
  private readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _salonContext = inject(SalonContextService);
  private readonly _salonSettings = inject(SalonSettingsService);
  private readonly _toast = inject(ToastService);
  protected readonly header = inject(AppHeaderService);

  // True while the active child route is queue-list (.../console/queue), not
  // current-client (the shell's default child, .../console).
  protected readonly onQueueListRoute = toSignal(
    this._router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this._router.url.endsWith(`/${RouteSegment.QUEUE}`)),
      startWith(this._router.url.endsWith(`/${RouteSegment.QUEUE}`)),
    ),
    { requireSync: true },
  );

  protected get currentClientLink(): string[] {
    return RoutePath.salonQueueConsole(this.salonId, this.queueId);
  }

  protected goBack(): void {
    if (window.history.length > 1) {
      this._location.back();
    } else {
      void this._router.navigate(
        this.onQueueListRoute() ? this.currentClientLink : RoutePath.salon(this.salonId),
      );
    }
  }

  // Straight to the STAFF tab: this console is a staff surface, and the
  // customer/owner tabs answer questions nobody here is asking.
  protected readonly howItWorksLink = RoutePath.howItWorks();
  protected readonly profileLink = RoutePath.account();
  protected readonly settingsLink = RoutePath.accountSettings();
  protected readonly howItWorksStaffParams = { [RouteQueryParam.TAB]: HowItWorksTab.STAFF };

  // staffFrozen (handoff §5): this non-owner staff member is over the plan's
  // staff limit and locked out of queue ops. Backend rejects their writes with
  // STAFF_LIMIT_REACHED; we lock the console so they see why, not a raw 403.
  protected readonly staffFrozen = this._salonContext.staffFrozen;

  protected readonly statusOptions: Array<'OPEN' | 'PAUSED' | 'CLOSED'> = [
    'OPEN',
    'PAUSED',
    'CLOSED',
  ];
  protected readonly showAutoCallNextSettings = signal(false);
  protected readonly queueOptionsOpen = signal(false);

  protected get salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  protected get queueId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.QUEUE_ID) ?? '';
  }

  ngOnInit(): void {
    this.console.init(this.salonId, this.queueId);
    this._salonSettings.load(this.salonId);
  }

  ngOnDestroy(): void {
    this.console.destroy(this.queueId);
  }

  protected setStatus(status: 'OPEN' | 'PAUSED' | 'CLOSED'): void {
    this.console.setStatus(this.salonId, this.queueId, status);
  }

  protected callNext(): void {
    // Both paths land on current-client: on success because that's where the
    // just-called client now shows, and on the conflict error (someone is
    // already SERVING) because that's the entry the barber has to resolve.
    // This action opens current-client regardless of how queue-list was reached.
    this.console.callNext(this.salonId, this.queueId, () => this._goToCurrentClient());
    if (this.onQueueListRoute()) this._goToCurrentClient();
  }

  protected setAutoCallNext(autoCallNext: boolean): void {
    this.console.setAutoCallNext(this.salonId, this.queueId, autoCallNext);
  }

  protected copyQueueLink(): void {
    const slug = this._salonSettings.salon()?.slug ?? '';
    if (!slug || !this.queueId) return;

    const path = RoutePath.visitQueue('', slug, this.queueId).join('/');
    navigator.clipboard
      .writeText(`${environment.appBaseUrl}${path}`)
      .then(() => this._toast.success('Queue link copied'))
      .catch(() => this._toast.error('Could not copy link'));
  }

  private _goToCurrentClient(): void {
    void this._router.navigate(this.currentClientLink);
  }
}
