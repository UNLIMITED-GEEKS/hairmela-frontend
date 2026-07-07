import { Component, computed, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavItem } from '../nav-item.types';
import { PublicNavComponent } from '../public-nav/public-nav.component';
import { PublicFooterComponent } from '../public-footer/public-footer.component';
import { InstallBannerComponent } from '../../install-banner/install-banner.component';
import { CurrentUserStore } from '../../../../core/auth/current-user.store';
import { GuestStore } from '../../../../core/guest/guest-store';

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
      { label: 'About',        icon: 'info', url: '/about',           sheet: true },
      { label: 'Get the app',  icon: 'info', url: '/how-to-install',  sheet: true },
      { label: 'Contact',      icon: 'mail', url: '/contact',         sheet: true },
      { label: 'Pricing',      icon: 'info', url: '/pricing',         sheet: true },
    ];

    if (isLoggedIn) {
      return [...base, { label: 'Dashboard', icon: 'home', url: '/dashboard', sheet: true, auth: true }];
    }
    if (isGuest) {
      return [
        ...base,
        { label: 'My Queues', icon: 'queue',      url: '/g/queues', sheet: true },
        { label: 'Sign In',   icon: 'login',      url: '/login',    sheet: true, auth: true },
        { label: 'Sign Up',   icon: 'person-add', url: '/register', sheet: true, cta: true },
      ];
    }
    return [
      ...base,
      { label: 'Sign In', icon: 'login',      url: '/login',    sheet: true, auth: true },
      { label: 'Sign Up', icon: 'person-add', url: '/register', sheet: true, cta: true },
    ];
  });
}
