import {
  AfterViewInit,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
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
import { RouteScrollRestorationService } from '../../../../core/scroll/route-scroll-restoration.service';
import { AddClientModalComponent } from '../../../../features/queue/add-client-modal/add-client-modal.component';
import { QueueConsoleService } from '../../../../features/queue/queue-console/queue-console.service';
import { StaffAppointmentModalService } from '../../../../features/queue/staff-appointment-modal/staff-appointment-modal.service';

@Component({
  selector: 'app-auth-shell',
  templateUrl: './auth-shell.component.html',
  providers: [QueueConsoleService],
  imports: [
    RouterOutlet,
    SidebarComponent,
    TopBarComponent,
    MobileTopBarComponent,
    BottomNavComponent,
    MobileSheetComponent,
    PullToRefreshIndicatorComponent,
    AddClientModalComponent,
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
    // Any navigation closes the sheet — tapping another bottom-nav tab while
    // it is open would otherwise leave it covering the page that just loaded.
    // Done here rather than on the tabs themselves so every route change is
    // covered, not just those four; the sheet's own links already close it as
    // they navigate.
    // Before the early return below: the sheet must close whether or not the
    // fade wrapper happens to be present.
    this.sheetOpen.set(false);

    const el = this._routeWrapper()?.nativeElement;
    if (!el) return;
    el.classList.remove('route-enter');
    // Reading offsetWidth flushes the pending style change, so re-adding the
    // class below counts as a fresh application and the animation replays.
    void el.offsetWidth;
    el.classList.add('route-enter');
  }
  private readonly _auth = inject(AuthService);
  private readonly _dashboardService = inject(SalonsStore);
  private readonly _salonContext = inject(SalonContextService);
  private readonly _orgContext = inject(OrgContextService);
  private readonly _pullToRefresh = inject(PullToRefreshService);
  private readonly _scrollRestoration = inject(RouteScrollRestorationService);
  private readonly _queueConsole = inject(QueueConsoleService);
  private readonly _staffAppointmentModal = inject(StaffAppointmentModalService);
  protected readonly _currentUser = inject(CurrentUserStore);

  // This shell's scroll region is the inner <main>, not the window (see
  // PullToRefreshService's class doc for why that distinction matters).
  private readonly _mainEl = viewChild.required<ElementRef<HTMLElement>>('mainScroll');

  protected readonly sheetOpen = signal(false);
  protected readonly appointmentRequest = this._staffAppointmentModal.request;

  constructor() {
    effect(() => {
      const request = this.appointmentRequest();
      if (!request) return;
      untracked(() => this._queueConsole.init(request.salonId, request.queueId));
    });
  }

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

  // Drives the initials avatar in the mobile top bar. Same composition the
  // desktop top bar already uses for its own avatar.
  protected readonly userFullName = computed(() => {
    const user = this._currentUser.user();
    return user ? `${user.firstName} ${user.lastName}` : '';
  });

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
      // Bottom nav dropped this in favour of the My Salon tab; on mobile the
      // account page is reached from the initials avatar in the top bar
      // instead. Still in the sidebar, which has the room.
      label: 'My Profile',
      icon: 'profile',
      url: RoutePath.account()[0],
      bottomNav: false,
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
    const main = this._mainEl().nativeElement;
    this._pullToRefresh.init({ scrollEl: main });
    this._scrollRestoration.register(main);
  }

  ngOnDestroy(): void {
    const request = this.appointmentRequest();
    if (request) this._queueConsole.destroy(request.queueId);
    this._scrollRestoration.unregister(this._mainEl().nativeElement);
    this._pullToRefresh.teardown();
  }

  protected closeCreateAppointment(): void {
    const request = this.appointmentRequest();
    if (request) this._queueConsole.destroy(request.queueId);
    this._staffAppointmentModal.close();
  }
}
