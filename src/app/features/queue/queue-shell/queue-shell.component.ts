import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import { QueueConsoleService } from '../queue-console/queue-console.service';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { ConnectionBannerComponent } from '../../../shared/components/connection-banner/connection-banner.component';

@Component({
  selector: 'app-queue-shell',
  templateUrl: './queue-shell.component.html',
  providers: [QueueConsoleService],
  imports: [RouterOutlet, SkeletonComponent, ConnectionBannerComponent],
})
export class QueueShellComponent implements OnInit, OnDestroy {
  protected readonly console = inject(QueueConsoleService);
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _salonContext = inject(SalonContextService);

  // staffFrozen (handoff §5): this non-owner staff member is over the plan's
  // staff limit and locked out of queue ops. Backend rejects their writes with
  // STAFF_LIMIT_REACHED; we lock the console so they see why, not a raw 403.
  protected readonly staffFrozen = this._salonContext.staffFrozen;

  protected readonly statusOptions: Array<'OPEN' | 'PAUSED' | 'CLOSED'> = ['OPEN', 'PAUSED', 'CLOSED'];

  protected get salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  protected get queueId(): string {
    return this._route.snapshot.paramMap.get('queueId') ?? '';
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
