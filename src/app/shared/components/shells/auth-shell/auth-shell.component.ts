import { Component, inject, signal, viewChild, ElementRef, OnInit, AfterViewInit, OnDestroy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CurrentUserStore } from '../../../../core/auth/current-user.store';
import { SalonContextService } from '../../../../core/salon-context/salon-context.service';
import { SalonsStore } from '../../../../core/salon-context/salons.store';
import { InvitesService } from '../../../../features/dashboard/invites.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { NavItem } from '../nav-item.types';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { TopBarComponent } from '../top-bar/top-bar.component';
import { MobileTopBarComponent } from '../mobile-top-bar/mobile-top-bar.component';
import { BottomNavComponent } from '../bottom-nav/bottom-nav.component';
import { MobileSheetComponent } from '../mobile-sheet/mobile-sheet.component';
import { PullToRefreshIndicatorComponent } from '../../pull-to-refresh-indicator/pull-to-refresh-indicator.component';
import { PullToRefreshService } from '../../../../core/pwa/pull-to-refresh.service';
import { OrgContextService } from '../../../../core/salon-context/org-context.service';
import { RoutePath } from '../../../../core/routing/route-paths';

@Component({
  selector: 'app-auth-shell',
  templateUrl: './auth-shell.component.html',
  imports: [
    RouterOutlet,
    SidebarComponent,
    TopBarComponent,
    MobileTopBarComponent,
    BottomNavComponent,
    MobileSheetComponent,
    PullToRefreshIndicatorComponent,
  ],
})
export class AuthShellComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly _invites = inject(InvitesService);
  private readonly _routeWrapper = viewChild<ElementRef<HTMLElement>>('routeWrapper');

  /**
   * Restarts the route-entry fade, driven by RouterOutlet's (activate).
   *
   * SYNCHRONOUS on purpose. The class cannot simply be left on — a CSS
   * animation replays only when the element re-enters the animating state — but
   * toggling a signal off and back on across a frame was visibly wrong: the new
   * page painted at full opacity first, then snapped to 0 when the class
   * arrived, which read as a flash. Removing the class and forcing a reflow in
   * the same tick means the browser never paints the intermediate state.
   */
  protected onRouteActivate(): void {
    const w = window as unknown as Record<string, unknown>;
    w['__hmActivates'] = ((w['__hmActivates'] as number) ?? 0) + 1;
    const el = this._routeWrapper()?.nativeElement;
    w['__hmWrapper'] = !!el;
    if (!el) return;
    el.classList.remove('route-enter');
    // Reading offsetWidth flushes the pending style change, so re-adding the
    // class below counts as a fresh application and the animation replays.
    void el.offsetWidth;
    el.classList.add('route-enter');
    w['__hmAnim'] = getComputedStyle(el).animationName + ' ' + getComputedStyle(el).animationDuration;
  }
  private readonly _auth = inject(AuthService);
  private readonly _dashboardService = inject(SalonsStore);
  private readonly _salonContext = inject(SalonContextService);
  private readonly _orgContext = inject(OrgContextService);
  private readonly _pullToRefresh = inject(PullToRefreshService);
  protected readonly _currentUser = inject(CurrentUserStore);

  // This shell's scroll region is the inner <main>, not the window (see
  // PullToRefreshService's class doc for why that distinction matters).
  private readonly _mainEl = viewChild.required<ElementRef<HTMLElement>>('mainScroll');

  protected readonly sheetOpen = signal(false);

  protected readonly salons = this._dashboardService.salons;
  // Display only (top bar / sidebar dropdown) — persists across pages with no
  // salon in their URL (Dashboard, Favourites, Search, Account) instead of
  // appearing to "forget" the selection. Role-gated nav (membership below)
  // intentionally does NOT use this — it stays tied to the strict,
  // route-derived activeSalonId so permissions never apply outside an actual
  // salon-scoped route.
  protected readonly displaySalonId = this._salonContext.displaySalonId;
  protected readonly membership = this._salonContext.membership;
  // Membership for displaySalonId — feeds the sidebar/mobile-sheet "Controls"
  // nav section so Staff/Services/Settings links stay visible for the
  // last-visited salon on pages with no salon in the URL. Page-level
  // components (tier banners, role checks) keep using the strict
  // `membership` above, untouched.
  protected readonly displayMembership = this._salonContext.displayMembership;

  protected readonly navItems: NavItem[] = [
    { label: 'Home', icon: 'home', url: RoutePath.dashboard()[0], bottomNav: true, sidebar: true },
    { label: 'Search', icon: 'search', url: RoutePath.search()[0], bottomNav: true, sidebar: true },
    {
      label: 'My History',
      icon: 'queue',
      url: RoutePath.queues()[0],
      bottomNav: true,
      sidebar: true,
    },
    {
      label: 'Favourites',
      icon: 'heart',
      url: RoutePath.favorites()[0],
      bottomNav: false,
      sidebar: true,
    },
    {
      label: 'My Profile',
      icon: 'profile',
      url: RoutePath.account()[0],
      bottomNav: true,
      sidebar: true,
    },
    { label: 'Logout', icon: 'login', action: () => this._auth.logout(), sidebar: true },
  ];

  logout(): void {
    this._auth.logout();
  }

  ngOnInit(): void {
    this._invites.load();
    this._dashboardService.load();
    // Resolve the user's owned org once so the tier banner's Upgrade CTA links
    // to /org/:orgId/billing; billing + orgOwnerGuard read the same cache.
    this._orgContext.ensureLoaded().subscribe();
  }

  ngAfterViewInit(): void {
    this._pullToRefresh.init({ scrollEl: this._mainEl().nativeElement });
  }

  ngOnDestroy(): void {
    this._pullToRefresh.teardown();
  }
}
