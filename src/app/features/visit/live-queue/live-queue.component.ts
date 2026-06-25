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

  private get _shellPrefix(): string {
    return this._route.snapshot.data['shellPrefix'] ?? '';
  }

  protected get positionUrl(): string {
    return `${this._shellPrefix}/s/${this._slug}/q/${this._queueId}/position`;
  }

  ngOnInit(): void {
    this.visit.watchQueue(this._queueId);
  }

  protected leaveQueue(): void {
    const prefix = this._shellPrefix;
    const segments = prefix ? [prefix, 's', this._slug] : ['s', this._slug];
    this.visit.leaveQueue(() => this._router.navigate(segments));
  }
}
