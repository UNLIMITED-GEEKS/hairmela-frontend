import { Component, OnInit, inject } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SalonVisitService } from '../salon-visit.service';

@Component({
  selector: 'app-live-queue',
  templateUrl: './live-queue.component.html',
  imports: [RouterLink],
})
export class LiveQueueComponent implements OnInit {
  protected readonly visit = inject(SalonVisitService);
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  private get _slug(): string {
    return this._route.snapshot.paramMap.get('slug') ?? '';
  }

  protected get _queueId(): string {
    return this._route.snapshot.paramMap.get('queueId') ?? '';
  }

  protected get positionUrl(): string {
    return `/s/${this._slug}/q/${this._queueId}/position`;
  }

  ngOnInit(): void {
    this.visit.watchQueue(this._queueId);
  }

  protected leaveQueue(): void {
    this.visit.leaveQueue(() => this._router.navigate(['/s', this._slug]));
  }
}
