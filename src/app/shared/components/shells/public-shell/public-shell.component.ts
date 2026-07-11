import { Component, computed, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavItem } from '../nav-item.types';
import { PublicNavComponent } from '../public-nav/public-nav.component';
import { PublicFooterComponent } from '../public-footer/public-footer.component';
import { InstallBannerComponent } from '../../install-banner/install-banner.component';
import { CurrentUserStore } from '../../../../core/auth/current-user.store';
import { GuestStore } from '../../../../core/guest/guest-store';
import { RoutePath } from '../../../../core/routing/route-paths';

@Component({
  selector: 'app-public-shell',
  templateUrl: './public-shell.component.html',
  imports: [RouterOutlet, PublicNavComponent, PublicFooterComponent, InstallBannerComponent],
})
export class PublicShellComponent {
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _guestStore = inject(GuestStore);

  protected readonly sheetOpen = signal(false);

  protected readonly navItems = computed<NavItem[]>(() => {
    const isLoggedIn = !!this._currentUser.user();
    const isGuest = this._guestStore.hasToken();

    const base: NavItem[] = [
      { label: 'About',        icon: 'info', url: RoutePath.about()[0],        sheet: true },
      { label: 'Get the app',  icon: 'info', url: RoutePath.howToInstall()[0], sheet: true },
      { label: 'Contact',      icon: 'mail', url: RoutePath.contact()[0],      sheet: true },
      { label: 'Pricing',      icon: 'info', url: RoutePath.pricing()[0],      sheet: true },
    ];

    if (isLoggedIn) {
      return [...base, { label: 'Dashboard', icon: 'home', url: RoutePath.dashboard()[0], sheet: true, auth: true }];
    }
    if (isGuest) {
      return [
        ...base,
        { label: 'My Queues', icon: 'queue',      url: RoutePath.guestQueues()[0], sheet: true },
        { label: 'Sign In',   icon: 'login',      url: RoutePath.login()[0],    sheet: true, auth: true },
        { label: 'Sign Up',   icon: 'person-add', url: RoutePath.register()[0], sheet: true, cta: true },
      ];
    }
    return [
      ...base,
      { label: 'Sign In', icon: 'login',      url: RoutePath.login()[0],    sheet: true, auth: true },
      { label: 'Sign Up', icon: 'person-add', url: RoutePath.register()[0], sheet: true, cta: true },
    ];
  });
}
