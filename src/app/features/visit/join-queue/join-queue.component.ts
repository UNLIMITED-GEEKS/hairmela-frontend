import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SalonVisitService } from '../salon-visit.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';

@Component({
  selector: 'app-join-queue',
  templateUrl: './join-queue.component.html',
  imports: [RouterLink],
})
export class JoinQueueComponent implements OnInit {
  protected readonly visit = inject(SalonVisitService);
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _currentUser = inject(CurrentUserStore);

  protected readonly selectedServiceId = signal<string | null>(null);

  private get _slug(): string {
    return this._route.snapshot.paramMap.get('slug') ?? '';
  }

  protected get queueId(): string {
    return this._route.snapshot.paramMap.get('queueId') ?? '';
  }

  protected get positionUrl(): string {
    return `/s/${this._slug}/q/${this.queueId}/position`;
  }

  protected readonly selectedStaff = computed(() =>
    this.visit.staffForQueue(this.queueId),
  );

  ngOnInit(): void {
    this.visit.watchQueue(this.queueId);
  }

  protected selectService(serviceId: string): void {
    this.selectedServiceId.set(serviceId);
  }

  protected joinQueue(): void {
    const salon = this.visit.salon();
    const queueId = this.queueId;
    if (!salon || !queueId) return;

    const user = this._currentUser.user();
    const leaderName = user ? user.firstName : 'Me';

    this.visit.joinQueue(
      salon.id,
      queueId,
      { members: [{ memberName: leaderName, serviceId: this.selectedServiceId() ?? undefined }] },
      () => {
        this._router.navigate(['/s', this._slug, 'q', queueId, 'position']);
      },
    );
  }
}
