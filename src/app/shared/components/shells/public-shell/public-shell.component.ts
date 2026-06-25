import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavItem } from '../nav-item.types';
import { PublicNavComponent } from '../public-nav/public-nav.component';
@Component({
  selector: 'app-public-shell',
  templateUrl: './public-shell.component.html',
  imports: [RouterOutlet, PublicNavComponent],
})
export class PublicShellComponent {
  protected readonly sheetOpen = signal(false);

  protected readonly navItems: NavItem[] = [
    { label: 'About',   icon: 'info',       url: '/about',    sheet: true },
    { label: 'Contact', icon: 'mail',       url: '/contact',  sheet: true },
    { label: 'Sign In', icon: 'login',      url: '/login',    sheet: true, auth: true },
    { label: 'Sign Up', icon: 'person-add', url: '/register', sheet: true, cta: true },
  ];
}
