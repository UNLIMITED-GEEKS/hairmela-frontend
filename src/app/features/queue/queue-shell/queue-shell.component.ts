import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterOutlet, RouterLink, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { QueueConsoleService } from '../queue-console/queue-console.service';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { ConnectionBannerComponent } from '../../../shared/components/connection-banner/connection-banner.component';
import { BackButtonComponent } from '../../../shared/components/back-button/back-button.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { RouteParam, RouteSegment, RoutePath } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-queue-shell',
  templateUrl: './queue-shell.component.html',
  providers: [QueueConsoleService],
  imports: [
    RouterOutlet,
    RouterLink,
    SkeletonComponent,
    ConnectionBannerComponent,
    BackButtonComponent,
    IconComponent,
  ],
})
export class QueueShellComponent implements OnInit, OnDestroy {
  protected readonly console = inject(QueueConsoleService);
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _salonContext = inject(SalonContextService);

  // True while the active child route is queue-list (.../console/queue), not
  // current-client (the shell's default child, .../console). The back
  // chevron above is shared by both — on queue-list it should always return
  // to current-client (hardcoded, not browser-history-based, since arriving
  // at queue-list can happen from several different places); on
  // current-client itself it keeps its normal history-based behavior.
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

  // staffFrozen (handoff §5): this non-owner staff member is over the plan's
  // staff limit and locked out of queue ops. Backend rejects their writes with
  // STAFF_LIMIT_REACHED; we lock the console so they see why, not a raw 403.
  protected readonly staffFrozen = this._salonContext.staffFrozen;

  protected readonly statusOptions: Array<'OPEN' | 'PAUSED' | 'CLOSED'> = ['OPEN', 'PAUSED', 'CLOSED'];

  protected get salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  protected get queueId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.QUEUE_ID) ?? '';
  }

  ngOnInit(): void {
    this.console.init(this.salonId, this.queueId);
  }

  ngOnDestroy(): void {
    this.console.destroy(this.queueId);
  }

  protected setStatus(status: 'OPEN' | 'PAUSED' | 'CLOSED'): void {
    this.console.setStatus(this.salonId, this.queueId, status);
  }

  protected callNext(): void {
    this.console.callNext(this.salonId, this.queueId, () => {
      this._location.back();
    });
  }
}
