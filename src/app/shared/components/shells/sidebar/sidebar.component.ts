import { Component, input, output, computed, signal, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NavItem } from '../nav-item.types';
import { NavIconComponent } from '../nav-icon/nav-icon.component';
import { Membership, SalonRole } from '../../../../core/salon-context/membership.types';
import { RouteSegment, RoutePath } from '../../../../core/routing/route-paths';

export interface ControlItem {
  readonly label: string;
  readonly url: string;
  readonly roles: SalonRole[];
  /** Minimum tier to use this feature; below it the link renders locked. */
  readonly requiresTier?: number;
}

const COLLAPSED_KEY = 'hm_sidebar_collapsed';

export const CONTROL_ITEMS: ControlItem[] = [
  { label: 'Staff', url: RouteSegment.STAFF, roles: [SalonRole.OWNER, SalonRole.ADMIN] },
  {
    label: 'Services',
    url: RouteSegment.SERVICES,
    roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF],
  },
  {
    label: 'Closures',
    url: RouteSegment.CLOSURES,
    roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF],
  },
  { label: 'Photos', url: RouteSegment.MEDIA, roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
  { label: 'Settings', url: RouteSegment.SETTINGS, roles: [SalonRole.OWNER, SalonRole.ADMIN] },
  {
    label: 'Analytics',
    url: RouteSegment.ANALYTICS,
    roles: [SalonRole.OWNER, SalonRole.ADMIN],
    requiresTier: 2,
  },
  {
    label: 'Share / QR',
    url: RouteSegment.SHARE,
    roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF],
  },
];

export interface VisibleControl extends ControlItem {
  /** True when the active salon's tier meets requiresTier (or none required). */
  readonly unlocked: boolean;
}

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  imports: [RouterLink, RouterLinkActive, NavIconComponent],
})
export class SidebarComponent implements OnInit {
  protected readonly RouteSegment = RouteSegment;
  protected readonly RoutePath = RoutePath;

  readonly navItems = input<NavItem[]>([]);
  readonly activeSalonId = input<string | null>(null);
  readonly membership = input<Membership | null>(null);
  readonly showLogout = input<boolean>(true);
  readonly logoutClick = output<void>();

  readonly collapsed = signal(false);

  readonly visibleControls = computed<VisibleControl[]>(() => {
    const m = this.membership();
    if (!m || !this.activeSalonId()) return [];
    return CONTROL_ITEMS.filter((c) => c.roles.includes(m.role)).map((c) => ({
      ...c,
      unlocked: c.requiresTier === undefined || m.tier >= c.requiresTier,
    }));
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
