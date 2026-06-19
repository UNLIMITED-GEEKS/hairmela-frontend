import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import { QueueConsoleService } from '../queue-console/queue-console.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';

@Component({
  selector: 'app-queue-shell',
  templateUrl: './queue-shell.component.html',
  providers: [QueueConsoleService],
  imports: [RouterOutlet, SkeletonComponent],
})
export class QueueShellComponent implements OnInit, OnDestroy {
  protected readonly console = inject(QueueConsoleService);
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);

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
