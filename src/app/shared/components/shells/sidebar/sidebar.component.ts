import { Component, input, output, computed, signal, effect, inject, OnInit } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NavItem } from '../nav-item.types';
import { NavIconComponent } from '../nav-icon/nav-icon.component';
import { Membership, SalonRole } from '../../../../core/salon-context/membership.types';
import { RouteSegment, RoutePath } from '../../../../core/routing/route-paths';
import { OrgContextService } from '../../../../core/salon-context/org-context.service';

export interface ControlItem {
  readonly label: string;
  readonly url: string;
  readonly roles: SalonRole[];
  /** Minimum tier to use this feature; below it the link renders locked. */
  readonly requiresTier?: number;
  /**
   * Builds the staff-scoped variant of this item's link (e.g. their own
   * staff/:staffId/services instead of the salon-wide services page). Only
   * set on items that have one; used only when the viewer's role is STAFF
   * and Membership.staffId is present — see SidebarComponent.controlLink().
   */
  readonly staffScopedLink?: (salonId: string, staffId: string) => string[];
}

const COLLAPSED_KEY = 'hm_sidebar_collapsed';

export const CONTROL_ITEMS: ControlItem[] = [
  { label: 'Staff', url: RouteSegment.STAFF, roles: [SalonRole.OWNER, SalonRole.ADMIN] },
  {
    label: 'Services',
    url: RouteSegment.SERVICES,
    roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF],
    staffScopedLink: RoutePath.salonStaffServices,
  },
  {
    label: 'Closures',
    url: RouteSegment.CLOSURES,
    roles: [SalonRole.OWNER, SalonRole.ADMIN],
  },
  {
    label: 'Photos',
    url: RouteSegment.MEDIA,
    roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF],
    staffScopedLink: RoutePath.salonStaffMedia,
  },
  { label: 'Settings', url: RouteSegment.SETTINGS, roles: [SalonRole.OWNER, SalonRole.ADMIN] },
  {
    label: 'Analytics',
    url: RouteSegment.ANALYTICS,
    roles: [SalonRole.OWNER, SalonRole.ADMIN],
  },
  {
    // Salon-wide appointment calendar — every staff member's bookings.
    // OWNER/ADMIN only; a staff member's OWN appointments are on Salon
    // Overview's "My Appointments" card instead (staff/:staffId/appointments,
    // not linked from here).
    label: 'Salon appointments',
    url: RouteSegment.APPOINTMENTS,
    roles: [SalonRole.OWNER, SalonRole.ADMIN],
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
  /**
   * Set by the guest shell — a guest has no session, so the dashboard would
   * only bounce them to login. Defaults false, keeping the auth shell on the
   * dashboard: there the user is already inside the app, and sending the logo
   * to the marketing home would read as being logged out.
   */
  readonly isGuest = input(false);

  // Home for a guest, dashboard for a signed-in user (see isGuest).
  protected readonly rootLink = computed(() =>
    this.isGuest() ? RoutePath.root() : RoutePath.dashboard(),
  );

  readonly navItems = input<NavItem[]>([]);
  readonly activeSalonId = input<string | null>(null);
  readonly membership = input<Membership | null>(null);
  readonly showLogout = input<boolean>(true);
  readonly logoutClick = output<void>();

  readonly collapsed = signal(false);

  private readonly _document = inject(DOCUMENT);
  private readonly _orgContext = inject(OrgContextService);

  // Mirrors the sidebar's current width onto a CSS custom property on <html>
  // so fixed-position elements elsewhere in the app (e.g. a bottom action
  // bar) can offset past it via `left: var(--sidebar-width)` without a direct
  // data connection to this component — this is the only place that knows
  // the sidebar's live width (it toggles between 64px/220px on click). Only
  // meaningful at md: and up, where the sidebar itself is visible (hidden
  // md:flex); consumers must gate their own use of the variable the same way.
  constructor() {
    effect(() => {
      this._document.documentElement.style.setProperty(
        '--sidebar-width',
        this.collapsed() ? '64px' : '220px',
      );
    });
  }

  readonly visibleControls = computed<VisibleControl[]>(() => {
    const m = this.membership();
    if (!m || !this.activeSalonId()) return [];
    return CONTROL_ITEMS.filter((c) => c.roles.includes(m.role)).map((c) => ({
      ...c,
      unlocked: c.requiresTier === undefined || m.tier >= c.requiresTier,
    }));
  });

  // Items with a staffScopedLink (Photos, Services): STAFF goes to their own
  // staff/:staffId page (Membership already carries staffId — no fetch
  // needed); OWNER/ADMIN get the salon-wide page. Falls back to the
  // salon-wide page if a STAFF membership somehow has no staffId (shouldn't
  // happen, but never renders a broken link).
  controlLink(item: VisibleControl): string[] {
    // Only ever invoked from the template inside the visibleControls().length
    // > 0 branch, which itself requires activeSalonId() truthy — never
    // actually null here, but the input's type is nullable.
    const salonId = this.activeSalonId() ?? '';
    const m = this.membership();
    if (item.staffScopedLink && m?.role === SalonRole.STAFF && m.staffId) {
      return item.staffScopedLink(salonId, m.staffId);
    }
    return ['/' + RouteSegment.SALONS, salonId, item.url];
  }

  readonly isOwner = computed(() => this.membership()?.role === SalonRole.OWNER);

  // Billing lives on the org, NOT the salon — deliberately kept out of the
  // "Salon Controls" block above, which needs an active salon and disappears
  // when a lapsed plan hides the salons (the case where an owner most needs
  // to reach billing).
  //
  // Gated on isOwner() because /organizations/mine returns orgs the user is
  // ASSOCIATED with, not only ones they own — staff get their employer's org
  // back, so the org id alone is not proof of ownership and was showing this
  // link to staff. Returns the id (not a boolean) so the template can bind it
  // with @if (...; as orgId).
  readonly billingOrgId = computed(() =>
    this.isOwner() ? (this._orgContext.ownedOrg()?.id ?? null) : null,
  );

  readonly sidebarItems = computed(() => this.navItems().filter((i) => i.sidebar && !i.action));

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

  onLogout(): void {
    this.logoutClick.emit();
  }
}
