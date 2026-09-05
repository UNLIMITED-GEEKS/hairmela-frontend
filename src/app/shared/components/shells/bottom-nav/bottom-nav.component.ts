import { Component, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { NavItem, NavIcon } from '../nav-item.types';
import { NavIconComponent } from '../nav-icon/nav-icon.component';
import { RoutePath } from '../../../../core/routing/route-paths';

@Component({
  selector: 'app-bottom-nav',
  templateUrl: './bottom-nav.component.html',
  imports: [RouterLink, RouterLinkActive, NavIconComponent, NgTemplateOutlet],
})
export class BottomNavComponent {
  protected readonly RoutePath = RoutePath;

  readonly navItems = input<NavItem[]>([]);

  /**
   * Adds a trailing tab that opens the mobile sheet instead of navigating.
   * False when the sheet has nothing to show — same gating the top bar's
   * hamburger used, so a customer with no salon and no owned org never gets a
   * tab that opens an empty panel.
   */
  readonly showSheetTab = input(false);
  /** True while the sheet is open, so the tab can render as active. */
  readonly sheetOpen = input(false);
  /**
   * Label and icon for that tab. Configurable because the two shells project
   * different sheets: the auth shell's is salon management ("My Salon"), the
   * guest shell's is plain navigation ("Menu").
   */
  readonly sheetTabLabel = input('Menu');
  readonly sheetTabIcon = input<NavIcon>('menu');
  readonly sheetToggle = output<void>();

  /**
   * A navigation tab was tapped. The shells close the sheet on this.
   *
   * NOT redundant with closing on the router's (activate): tapping the tab for
   * the route you are ALREADY on navigates to the same URL, which Angular
   * ignores by default — no component is recreated, (activate) never fires,
   * and the sheet would sit open over the page. Every other tab was closing
   * it, so that one behaving differently read as a bug.
   */
  readonly navigate = output<void>();

  protected bottomItems(): NavItem[] {
    return this.navItems().filter((i) => i.bottomNav);
  }

  // Split so the sheet tab can sit BETWEEN them: a CTA (the guest shell's Sign
  // Up) is a filled button rather than a tab, and it reads as the end of the
  // bar — appending the sheet tab after it left the CTA stranded mid-row.
  protected plainItems(): NavItem[] {
    return this.bottomItems().filter((i) => !i.cta);
  }

  protected ctaItems(): NavItem[] {
    return this.bottomItems().filter((i) => i.cta);
  }
}
