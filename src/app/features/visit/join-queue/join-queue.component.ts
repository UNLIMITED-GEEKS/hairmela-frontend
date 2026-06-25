import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SalonVisitService } from '../salon-visit.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { GuestStore } from '../../../core/guest/guest-store';

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
  private readonly _guestStore = inject(GuestStore);

  protected readonly selectedServiceId = signal<string | null>(null);
  protected readonly showGuestDialog = signal(false);
  protected readonly guestName = signal('');
  protected readonly guestPhone = signal('');

  private get _slug(): string {
    return this._route.snapshot.paramMap.get('slug') ?? '';
  }

  private get _shellPrefix(): string {
    return this._route.snapshot.data['shellPrefix'] ?? '';
  }

  protected get queueId(): string {
    return this._route.snapshot.paramMap.get('queueId') ?? '';
  }

  protected get positionUrl(): string {
    const prefix = this._shellPrefix;
    return `${prefix}/s/${this._slug}/q/${this.queueId}/position`;
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
    const user = this._currentUser.user();
    if (!user) {
      this.showGuestDialog.set(true);
      return;
    }
    this._submitJoin(user.firstName);
  }

  protected confirmGuestJoin(): void {
    const name = this.guestName().trim();
    const phone = this.guestPhone().trim();
    if (!name || !phone) return;
    this.showGuestDialog.set(false);
    this._submitJoin(name, phone);
  }

  private _submitJoin(memberName: string, phone?: string): void {
    const salon = this.visit.salon();
    const queueId = this.queueId;
    const slug = this._slug;
    const prefix = this._shellPrefix;
    if (!salon || !queueId) return;

    this.visit.joinQueue(
      salon.id,
      queueId,
      slug,
      { members: [{ memberName, phone, serviceId: this.selectedServiceId() ?? undefined }] },
      (guestToken) => {
        if (guestToken) this._guestStore.setToken(guestToken);
        const segments = prefix
          ? [prefix, 's', slug, 'q', queueId, 'position']
          : ['s', slug, 'q', queueId, 'position'];
        this._router.navigate(segments);
      },
    );
  }
}
