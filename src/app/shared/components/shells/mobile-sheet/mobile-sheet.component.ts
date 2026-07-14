import { Component, input, output, computed } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NavItem } from '../nav-item.types';
import { NavIconComponent } from '../nav-icon/nav-icon.component';
import { Membership, SalonRole } from '../../../../core/salon-context/membership.types';
import { CONTROL_ITEMS, VisibleControl } from '../sidebar/sidebar.component';
import { RouteSegment, RoutePath } from '../../../../core/routing/route-paths';

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

  readonly isOwner = computed(() => this.membership()?.role === SalonRole.OWNER);

  protected sheetItems(): NavItem[] {
    return this.navItems().filter((i) => i.sheet);
  }

  // Items with a staffScopedLink (Photos, Services): STAFF goes to their own
  // staff/:staffId page (Membership already carries staffId — no fetch
  // needed); OWNER/ADMIN get the salon-wide page.
  controlLink(item: VisibleControl): string[] {
    const salonId = this.activeSalonId() ?? '';
    const m = this.membership();
    if (item.staffScopedLink && m?.role === SalonRole.STAFF && m.staffId) {
      return item.staffScopedLink(salonId, m.staffId);
    }
    return ['/' + RouteSegment.SALONS, salonId, item.url];
  }
}
