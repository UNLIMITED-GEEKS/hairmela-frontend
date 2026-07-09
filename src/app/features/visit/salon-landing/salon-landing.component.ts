import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SalonVisitService } from '../salon-visit.service';
import { SalonPublicStaffDto } from '../../../api/models/salon-public-staff-dto';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { FavoritesService } from '../../../core/favorites/favorites.service';
import { JoinDialogComponent } from '../join-dialog/join-dialog.component';

interface BarberAvailability {
  readonly label: string;
  readonly badgeClasses: string;
  readonly joinable: boolean;
  readonly showBadge: boolean;
}

interface SalonStatusBadge {
  readonly label: string;
  readonly badgeClasses: string;
}

@Component({
  selector: 'app-salon-landing',
  templateUrl: './salon-landing.component.html',
  imports: [JoinDialogComponent],
})
export class SalonLandingComponent implements OnInit {
  protected readonly visit = inject(SalonVisitService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _favorites = inject(FavoritesService);

  // Frozen = the salon is over its org's plan limit and can't accept walk-ins
  // (the backend rejects the join). Pre-block: hide the barbers entirely and
  // show a notice instead of letting a customer tap into a dead flow.
  protected readonly frozen = computed(() => this.visit.salonData()?.isFrozen ?? false);

  ngOnInit(): void {
    if (this._currentUser.user()) {
      this._favorites.ensureIdsLoaded();
    }
  }

  // Heart shown only when authenticated (handoff §2) — same rule as the card,
  // absent (not disabled) for guest/anonymous visitors on this shared route.
  protected readonly showHeart = computed(() => !!this._currentUser.user());

  protected readonly isFavorited = computed(() => {
    const id = this.visit.salon()?.id;
    return id ? this._favorites.isFavorited(id) : false;
  });

  protected toggleFavorite(): void {
    const id = this.visit.salon()?.id;
    if (id) this._favorites.toggle({ id });
  }

  protected get _slug(): string {
    return this._route.snapshot.paramMap.get('slug') ?? '';
  }

  protected get _shellPrefix(): string {
    return this._route.snapshot.data['shellPrefix'] ?? '';
  }

  // Salon open/closed badge — computed server-side in the salon's own timezone
  // (openState), never derived on the client. null until the payload loads.
  protected readonly salonStatus = computed<SalonStatusBadge | null>(() => {
    const data = this.visit.salonData();
    if (!data) return null;
    switch (data.openState) {
      case 'OPEN':
        return {
          label: 'Open Now',
          badgeClasses: 'bg-success-light text-success border-success/20',
        };
      case 'CLOSED_HOURS':
        return { label: 'Closed', badgeClasses: 'bg-primary-light text-primary border-primary/20' };
      default: // 'CLOSED_TODAY'
        return {
          label: 'Closed today',
          badgeClasses: 'bg-primary-light text-primary border-primary/20',
        };
    }
  });

  // Services-first landing: null = showing the services list; set = showing
  // the barbers who offer that service. A local view toggle only — no
  // navigation, no request, since visit.services()/staffList() are already
  // loaded (same instant, client-side-filter pattern as staffServices() on
  // the join screen).
  protected readonly selectedServiceId = signal<string | null>(null);

  protected readonly staffForSelectedService = computed(() => {
    const serviceId = this.selectedServiceId();
    if (!serviceId) return [];
    return this.visit.staffList().filter((s) => s.serviceIds.includes(serviceId));
  });

  protected readonly selectedService = computed(() => {
    const serviceId = this.selectedServiceId();
    return serviceId ? (this.visit.services().find((s) => s.id === serviceId) ?? null) : null;
  });

  protected selectService(serviceId: string): void {
    this.selectedServiceId.set(serviceId);
  }

  protected backToServices(): void {
    this.selectedServiceId.set(null);
  }

  // Real availability from the barber's live queue status. CLOSED or PAUSED
  // queues are not joinable from the landing page. When the salon itself is
  // closed, no barber is joinable and no badge shows.
  protected availability(staff: SalonPublicStaffDto): BarberAvailability {
    if (!this.visit.salonData()?.isOpen) {
      return { label: '', badgeClasses: '', joinable: false, showBadge: false };
    }
    switch (staff.queueStatus) {
      case 'OPEN':
        return {
          label: 'Available',
          badgeClasses: 'bg-success-light text-success border-success/20',
          joinable: true,
          showBadge: true,
        };
      case 'PAUSED':
        return {
          label: 'On break',
          badgeClasses: 'bg-warning-light text-warning border-warning/30',
          joinable: false,
          showBadge: true,
        };
      default: // 'CLOSED' or null (no queue yet)
        return {
          label: 'Closed',
          badgeClasses: 'bg-primary-light text-primary border-primary/20',
          joinable: false,
          showBadge: true,
        };
    }
  }

  // Dialog target — the barber the join dialog is open for. null = closed.
  protected readonly dialogStaff = signal<SalonPublicStaffDto | null>(null);

  protected selectBarber(staff: SalonPublicStaffDto): void {
    // selectBarber() itself navigates for every other outcome (register
    // redirect, existing entry -> position page); it only returns true when
    // this is a genuine fresh join, which is the one case the dialog handles.
    if (this.visit.selectBarber(staff, this._slug)) {
      this.dialogStaff.set(staff);
    }
  }

  protected closeDialog(): void {
    this.dialogStaff.set(null);
  }
}
