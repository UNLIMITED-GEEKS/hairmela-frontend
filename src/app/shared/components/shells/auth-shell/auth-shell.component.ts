import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CurrentUserStore } from '../../../../core/auth/current-user.store';
import { SalonContextService } from '../../../../core/salon-context/salon-context.service';
import { DashboardService } from '../../../../features/dashboard/dashboard.service';
import { InvitesService } from '../../../../features/dashboard/invites.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { NavItem } from '../nav-item.types';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { TopBarComponent } from '../top-bar/top-bar.component';
import { MobileTopBarComponent } from '../mobile-top-bar/mobile-top-bar.component';
import { BottomNavComponent } from '../bottom-nav/bottom-nav.component';
import { MobileSheetComponent } from '../mobile-sheet/mobile-sheet.component';

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
  ],
})
export class AuthShellComponent implements OnInit {
  private readonly _invites = inject(InvitesService);
  private readonly _auth = inject(AuthService);
  private readonly _dashboardService = inject(DashboardService);
  private readonly _salonContext = inject(SalonContextService);
  protected readonly _currentUser = inject(CurrentUserStore);

  protected readonly sheetOpen = signal(false);

  protected readonly salons = this._dashboardService.salons;
  protected readonly activeSalonId = this._salonContext.activeSalonId;
  protected readonly membership = this._salonContext.membership;

  protected readonly navItems: NavItem[] = [
    { label: 'Dashboard', icon: 'home',   url: '/dashboard', bottomNav: true, sidebar: true, sheet: true },
    { label: 'My Visits', icon: 'queue',  url: '/queues',    bottomNav: true, sidebar: true, sheet: true },
    { label: 'Account',   icon: 'person', url: '/account',   bottomNav: true, sidebar: true, sheet: true },
    { label: 'Logout',    icon: 'login',  action: () => this._auth.logout(),  sheet: true },
  ];

  logout(): void {
    this._auth.logout();
  }

  ngOnInit(): void {
    this._invites.load();
    this._dashboardService.load();
  }
}
