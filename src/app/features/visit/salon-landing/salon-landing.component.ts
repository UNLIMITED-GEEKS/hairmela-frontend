import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SalonVisitService } from '../salon-visit.service';
import { SalonPublicStaffDto } from '../../../api/models/salon-public-staff-dto';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { FavoritesService } from '../../../core/favorites/favorites.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { TabsComponent, TabItem } from '../../../shared/components/tabs/tabs.component';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { GalleryModalComponent } from '../../../shared/components/gallery-modal/gallery-modal.component';
import { BackButtonComponent } from '../../../shared/components/back-button/back-button.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import {
  StaffCardComponent,
  StaffCardAvailability,
} from '../../../shared/components/staff-card/staff-card.component';
import { ServiceListItemComponent } from '../../../shared/components/service-list-item/service-list-item.component';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { InstallPromptService } from '../../../core/pwa/install-prompt.service';
import { RouteParam, RoutePath, RouteQueryParam } from '../../../core/routing/route-paths';

const LANDING_TABS: TabItem[] = [
  { id: 'about', label: 'About' },
  { id: 'services', label: 'Services' },
  { id: 'staffs', label: 'Staffs' },
];

interface SalonStatusBadge {
  readonly label: string;
  readonly badgeClasses: string;
}

@Component({
  selector: 'app-salon-landing',
  templateUrl: './salon-landing.component.html',
  imports: [
    SkeletonComponent,
    TabsComponent,
    GalleryModalComponent,
    BackButtonComponent,
    IconComponent,
    StaffCardComponent,
    ServiceListItemComponent,
    MediaUrlPipe,
    RouterLink,
  ],
})
export class SalonLandingComponent implements OnInit {
  protected readonly visit = inject(SalonVisitService);
  protected readonly install = inject(InstallPromptService);
  protected readonly howToInstallLink = RoutePath.howToInstall();
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _favorites = inject(FavoritesService);

  // Fallback photo for salons with no uploaded image — same asset used by
  // SalonCardComponent (public/salon-placeholder.jpg).
  protected readonly placeholderImage = '/salon-placeholder.jpg';

  protected readonly landingTabs = LANDING_TABS;
  // Persisted on SalonVisitService (not local state) so navigating away and
  // back within the same salon visit restores the previously selected tab.
  protected readonly activeTab = this.visit.landingTab;

  protected setTab(tab: string): void {
    // Leaving the Services tab for another one drops the selected service —
    // it should only survive navigating away to a barber's queue page and
    // back, not surface again after the user has moved on to a different tab.
    if (this.visit.landingTab() === 'services' && tab !== 'services') {
      this.visit.selectedServiceId.set(null);
    }
    this.visit.landingTab.set(tab as 'about' | 'services' | 'staffs');
  }

  // Both the Staffs tab (no service context) and the Services tab's
  // barber-drilldown (a service already chosen) land here — the queue page is
  // the single place a join can now be started from, so both flows converge
  // on it instead of each owning their own join-dialog trigger.
  protected openStaffQueue(staff: SalonPublicStaffDto, serviceId?: string): void {
    if (!staff.queueId) return;
    this._router.navigate(RoutePath.visitQueue(this._shellPrefix, this._slug, staff.queueId), {
      queryParams: serviceId ? { [RouteQueryParam.SERVICE_ID]: serviceId } : {},
    });
  }

  // Frozen = the salon is over its org's plan limit and can't accept walk-ins
  // (the backend rejects the join). Pre-block: hide the barbers entirely and
  // show a notice instead of letting a customer tap into a dead flow.
  protected readonly frozen = computed(() => this.visit.salonData()?.isFrozen ?? false);

  // About tab's photo gallery — the full salon.galleryUrls array is always
  // passed to the modal (only the first 4 are shown as a preview grid).
  protected readonly galleryOpen = signal(false);
  protected readonly galleryStartIndex = signal(0);

  protected openGallery(index: number): void {
    this.galleryStartIndex.set(index);
    this.galleryOpen.set(true);
  }

  protected closeGallery(): void {
    this.galleryOpen.set(false);
  }

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
    return this._route.snapshot.paramMap.get(RouteParam.SLUG) ?? '';
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
          badgeClasses: 'bg-open-badge text-success border-success/20',
        };
      case 'CLOSED_HOURS':
        return { label: 'Closed', badgeClasses: 'bg-error-light text-error border-error/20' };
      default: // 'CLOSED_TODAY'
        return {
          label: 'Closed today',
          badgeClasses: 'bg-error-light text-error border-error/20',
        };
    }
  });

  // Services-first landing: null = showing the services list; set = showing
  // the barbers who offer that service. Persisted on SalonVisitService (not
  // local state) so navigating to a barber's queue page and back restores the
  // same service instead of resetting to the plain services list — no request
  // either way, since visit.services()/staffList() are already loaded (same
  // instant, client-side-filter pattern as staffServices() on the join screen).
  protected readonly selectedServiceId = this.visit.selectedServiceId;

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
    this.visit.selectedServiceId.set(serviceId);
  }

  protected backToServices(): void {
    this.visit.selectedServiceId.set(null);
  }

  // Real availability from the barber's live queue status. CLOSED or PAUSED
  // queues are not joinable from the landing page. When the salon itself is
  // closed, no barber is joinable and no badge shows.
  protected availability(staff: SalonPublicStaffDto): StaffCardAvailability {
    if (!this.visit.salonData()?.isOpen) {
      return { label: '', badgeClasses: '', joinable: false, showBadge: false };
    }
    switch (staff.queueStatus) {
      case 'OPEN':
        return {
          label: 'Available Now',
          badgeClasses: 'bg-success-light text-success border-success/20',
          joinable: true,
          showBadge: true,
        };
      case 'PAUSED':
        return {
          label: 'Unavailable',
          badgeClasses: 'bg-warning-light text-warning border-warning/30',
          joinable: false,
          showBadge: true,
        };
      default: // 'CLOSED' or null (no queue yet)
        return {
          label: 'Unavailable',
          badgeClasses: 'bg-primary-light text-primary border-primary/20',
          joinable: false,
          showBadge: true,
        };
    }
  }
}
