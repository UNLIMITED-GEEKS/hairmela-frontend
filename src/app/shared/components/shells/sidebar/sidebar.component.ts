import { Component, input, output, computed, signal, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NavItem } from '../nav-item.types';
import { NavIconComponent } from '../nav-icon/nav-icon.component';
import { Membership, SalonRole } from '../../../../core/salon-context/membership.types';

export interface ControlItem {
  readonly label: string;
  readonly url: string;
  readonly roles: SalonRole[];
}

const COLLAPSED_KEY = 'hm_sidebar_collapsed';

export const CONTROL_ITEMS: ControlItem[] = [
  { label: 'Staff',      url: 'staff',     roles: [SalonRole.OWNER, SalonRole.ADMIN] },
  { label: 'Services',   url: 'services',  roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
  { label: 'Closures',   url: 'closures',  roles: [SalonRole.OWNER, SalonRole.ADMIN] },
  { label: 'Photos',     url: 'media',     roles: [SalonRole.OWNER, SalonRole.ADMIN] },
  { label: 'Settings',   url: 'settings',   roles: [SalonRole.OWNER, SalonRole.ADMIN] },
  { label: 'Analytics',  url: 'analytics', roles: [SalonRole.OWNER, SalonRole.ADMIN] },
  { label: 'Share / QR', url: 'share',     roles: [SalonRole.OWNER, SalonRole.ADMIN] },
];

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  imports: [RouterLink, RouterLinkActive, NavIconComponent],
})
export class SidebarComponent implements OnInit {
  readonly navItems = input<NavItem[]>([]);
  readonly activeSalonId = input<string | null>(null);
  readonly membership = input<Membership | null>(null);
  readonly showLogout = input<boolean>(true);
  readonly logoutClick = output<void>();

  readonly collapsed = signal(false);

  readonly visibleControls = computed(() => {
    const m = this.membership();
    if (!m || !this.activeSalonId()) return [];
    return CONTROL_ITEMS.filter((c) => c.roles.includes(m.role));
  });

  readonly isOwner = computed(() => this.membership()?.role === SalonRole.OWNER);

  ngOnInit(): void {
    try {
      this.collapsed.set(localStorage.getItem(COLLAPSED_KEY) === '1');
    } catch { /* ignore */ }
  }

  toggle(): void {
    this.collapsed.update((v) => !v);
    try {
      localStorage.setItem(COLLAPSED_KEY, this.collapsed() ? '1' : '0');
    } catch { /* ignore */ }
  }

  sidebarItems(): NavItem[] {
    return this.navItems().filter((i) => i.sidebar && !i.action);
  }

  onLogout(): void {
    this.logoutClick.emit();
  }
}
