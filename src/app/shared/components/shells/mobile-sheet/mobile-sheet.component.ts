import { Component, input, output, computed } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NavItem } from '../nav-item.types';
import { NavIconComponent } from '../nav-icon/nav-icon.component';
import { Membership, SalonRole } from '../../../../core/salon-context/membership.types';
import { ControlItem, CONTROL_ITEMS } from '../sidebar/sidebar.component';

@Component({
  selector: 'app-mobile-sheet',
  templateUrl: './mobile-sheet.component.html',
  styleUrl: './mobile-sheet.component.scss',
  imports: [RouterLink, RouterLinkActive, NavIconComponent],
})
export class MobileSheetComponent {
  readonly navItems = input<NavItem[]>([]);
  readonly open = input(false);
  readonly activeSalonId = input<string | null>(null);
  readonly membership = input<Membership | null>(null);
  readonly closed = output<void>();

  readonly visibleControls = computed<ControlItem[]>(() => {
    const m = this.membership();
    if (!m || !this.activeSalonId()) return [];
    return CONTROL_ITEMS.filter((c) => c.roles.includes(m.role));
  });

  readonly isOwner = computed(() => this.membership()?.role === SalonRole.OWNER);

  protected sheetItems(): NavItem[] {
    return this.navItems().filter((i) => i.sheet);
  }
}
