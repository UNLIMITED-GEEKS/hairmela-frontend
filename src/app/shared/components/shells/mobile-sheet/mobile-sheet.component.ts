import { Component, input, output, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NavItem } from '../nav-item.types';
import { NavIconComponent } from '../nav-icon/nav-icon.component';
import { Membership, SalonRole } from '../../../../core/salon-context/membership.types';
import { CONTROL_ITEMS, VisibleControl } from '../sidebar/sidebar.component';
import { RouteSegment, RoutePath } from '../../../../core/routing/route-paths';
import { OrgContextService } from '../../../../core/salon-context/org-context.service';
import { AppPlatformService } from '../../../../core/native/app-platform.service';

@Component({
  selector: 'app-mobile-sheet',
  templateUrl: './mobile-sheet.component.html',
  styleUrl: './mobile-sheet.component.scss',
  imports: [RouterLink, RouterLinkActive, NavIconComponent],
})
export class MobileSheetComponent {
  protected readonly RouteSegment = RouteSegment;
  protected readonly RoutePath = RoutePath;

  readonly navItems = input<NavItem[]>([]);
  readonly open = input(false);
  readonly activeSalonId = input<string | null>(null);
  readonly membership = input<Membership | null>(null);
  readonly closed = output<void>();

  readonly visibleControls = computed<VisibleControl[]>(() => {
    const m = this.membership();
    if (!m || !this.activeSalonId()) return [];
    return CONTROL_ITEMS.filter((c) => c.roles.includes(m.role)).map((c) => ({
      ...c,
      unlocked: c.requiresTier === undefined || m.tier >= c.requiresTier,
    }));
  });

  private readonly _orgContext = inject(OrgContextService);

  readonly isOwner = computed(() => this.membership()?.role === SalonRole.OWNER);

  /**
   * This user's OWN queue console in the active salon, or null when they have
   * none to open.
   *
   * A salon has one queue per staff member, so "my console" cannot be derived
   * from the salon alone — every other control here is salon-scoped and needs
   * no such lookup. Membership.queueId exists for exactly this (see its own
   * comment), so the link resolves synchronously with no extra fetch.
   *
   * Null for anyone without a staff row, and for a staff member whose queue
   * has not been provisioned yet — an owner who does not serve clients simply
   * does not see the item.
   *
   * Also gated on isAcceptingClients: someone who has switched themselves off
   * as a staff member is not taking clients at all, so a console is of no use
   * to them. That flag is NOT the queue's OPEN/PAUSED/CLOSED status — pausing
   * a queue leaves it true, so a paused staff member still gets the link,
   * which matters because the console is where they go to unpause.
   */
  readonly myQueueConsoleLink = computed(() => {
    const m = this.membership();
    if (!m?.queueId || !m.isAcceptingClients) return null;
    return RoutePath.salonQueueConsole(m.salonId, m.queueId);
  });

  // Org-scoped and owner-gated — see the matching comment in SidebarComponent
  // for both why this sits outside "Salon Controls" and why the org id alone
  // is not proof of ownership.
  private readonly _platform = inject(AppPlatformService);
  readonly billingOrgId = computed(() =>
    !this._platform.isNative && this.isOwner() ? (this._orgContext.ownedOrg()?.id ?? null) : null,
  );

  protected sheetItems(): NavItem[] {
    return this.navItems().filter((i) => i.sheet);
  }

  /**
   * True when every section of this sheet is gated off, so opening it would
   * show an empty panel.
   *
   * Read by the mobile top bar to hide its toggle entirely. Computed HERE
   * rather than in the top bar so the two can never disagree — this component
   * owns the three @if conditions in its own template, and a customer with no
   * salon and no owned org fails all of them. (The auth shell sets no
   * `sheet: true` on its nav items, so that first section is always empty
   * there; only the guest shell populates it.)
   */
  readonly isEmpty = computed(
    () =>
      this.sheetItems().length === 0 &&
      this.visibleControls().length === 0 &&
      !this.activeSalonId() &&
      !this.billingOrgId(),
  );

  // Items with a staffScopedLink (Photos, Services): STAFF goes to their own
  // staff/:staffId page (Membership already carries staffId — no fetch
  // needed); OWNER/ADMIN get the salon-wide page..
  controlLink(item: VisibleControl): string[] {
    const salonId = this.activeSalonId() ?? '';
    const m = this.membership();
    if (item.staffScopedLink && m?.role === SalonRole.STAFF && m.staffId) {
      return item.staffScopedLink(salonId, m.staffId);
    }
    return ['/' + RouteSegment.SALONS, salonId, item.url];
  }
}
