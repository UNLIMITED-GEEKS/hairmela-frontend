import { Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NavItem } from '../nav-item.types';
import { NavIconComponent } from '../nav-icon/nav-icon.component';
import { RoutePath } from '../../../../core/routing/route-paths';

@Component({
  selector: 'app-bottom-nav',
  templateUrl: './bottom-nav.component.html',
  imports: [RouterLink, RouterLinkActive, NavIconComponent],
})
export class BottomNavComponent {
  protected readonly RoutePath = RoutePath;

  readonly navItems = input<NavItem[]>([]);

  protected bottomItems(): NavItem[] {
    return this.navItems().filter((i) => i.bottomNav);
  }
}
