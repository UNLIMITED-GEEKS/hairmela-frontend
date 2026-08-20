import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SalonsStore } from '../../core/salon-context/salons.store';
import { CurrentUserStore } from '../../core/auth/current-user.store';
import { ActiveQueuesService } from '../queues/auth-queues/active-queues.service';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { PendingInvitesComponent } from './salon/pending-invites/pending-invites.component';
import { MyVisitsComponent } from './my-visits/my-visits.component';
import { QrScannerComponent } from '../../shared/components/qr-scanner/qr-scanner.component';
import { AvatarComponent } from '../../shared/components/avatar/avatar.component';
import { SalonCardComponent } from '../../shared/components/salon-card/salon-card.component';
import { CategoryPillsComponent } from '../../shared/components/category-pills/category-pills.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { JoinBannerComponent } from './join-banner/join-banner.component';
import { CategoriesService } from '../../core/categories/categories.service';
import { SalonListingService } from '../../marketing/landing/salon-listing.service';
import { ToastService } from '../../core/toast/toast.service';
import { InstallPromptService } from '../../core/pwa/install-prompt.service';
import { CreateSalonCardComponent } from '../../shared/components/create-salon-card/create-salon-card.component';
import { RoutePath, RouteQueryParam } from '../../core/routing/route-paths';
import { AppPlatformService } from '../../core/native/app-platform.service';

// Local-time greeting. Boundaries follow common usage: morning until noon,
// afternoon until 17:00, evening after.
function timeOfDayGreeting(hour: number): string {
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  imports: [
    RouterLink,
    SkeletonComponent,
    PendingInvitesComponent,
    // MyVisitsComponent,
    QrScannerComponent,
    AvatarComponent,
    SalonCardComponent,
    CategoryPillsComponent,
    IconComponent,
    JoinBannerComponent,
    CreateSalonCardComponent,
  ],
})
export class DashboardComponent implements OnInit {
  protected readonly _dashboardService = inject(SalonsStore);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _activeQueues = inject(ActiveQueuesService);
  private readonly _toast = inject(ToastService);
  private readonly _router = inject(Router);

  protected readonly listing = inject(SalonListingService);
  protected readonly categoriesService = inject(CategoriesService);
  protected readonly install = inject(InstallPromptService);
  // isAppContext, NOT install.installed(): that flag falls back to a stored
  // hm_pwa_installed value, so someone who once installed the PWA reads as
  // "installed" even in a normal browser tab — and would wrongly lose the
  // prompt. isAppContext uses live display checks instead.
  protected readonly platform = inject(AppPlatformService);

  protected readonly loading = this._dashboardService.loading;
  protected readonly error = this._dashboardService.error;
  protected readonly user = this._currentUser.user;

  // Read once at construction, not as a computed: no signal changes when the
  // clock crosses noon, so a computed would be no more live than this — and a
  // stale greeting on a page left open for hours isn't worth a timer.
  protected readonly greeting = timeOfDayGreeting(new Date().getHours());

  protected readonly activeEntries = this._activeQueues.entries;

  protected readonly showScanner = signal(false);

  protected readonly notificationsLink = RoutePath.notifications();
  protected readonly favoritesLink = RoutePath.favorites();
  protected readonly searchLink = RoutePath.search();
  protected readonly howToInstallLink = RoutePath.download();
  protected readonly howItWorksLink = RoutePath.howItWorks();

  ngOnInit(): void {
    this._dashboardService.load();
    this._activeQueues.load();
    this.categoriesService.load();
  }

  protected onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.listing.setSearch(value);
  }

  protected onSearchSubmit(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this._router.navigate(RoutePath.search(), { queryParams: { [RouteQueryParam.SEARCH]: value } });
  }

  protected onCategorySelect(slug: string): void {
    this.listing.setCategory(slug);
  }

  protected onQrScanned(text: string): void {
    this.showScanner.set(false);
    // Extract /s/:slug from the scanned URL
    try {
      const url = new URL(text);
      const match = url.pathname.match(/^\/s\/([^/]+)/);
      if (match) {
        this._router.navigate(RoutePath.visitSalon('', match[1]));
        return;
      }
    } catch {
      /* not a URL */
    }
    this._toast.error('Not a valid HairMela QR code');
  }
}
