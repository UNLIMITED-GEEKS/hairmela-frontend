import { Component, input, output, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NavItem } from '../nav-item.types';
import { NavIconComponent } from '../nav-icon/nav-icon.component';
import { RoutePath } from '../../../../core/routing/route-paths';
import { AppPlatformService } from '../../../../core/native/app-platform.service';

@Component({
  selector: 'app-public-nav',
  templateUrl: './public-nav.component.html',
  styleUrl: './public-nav.component.scss',
  imports: [RouterLink, RouterLinkActive],
})
export class PublicNavComponent {
  readonly navItems = input<NavItem[]>([]);
  readonly sheetOpen = input(false);
  readonly sheetToggle = output<void>();

  // Dashboard when installed, marketing home on web — see AppPlatformService.
  protected readonly rootLink = inject(AppPlatformService).homeLink;

  protected centerItems(): NavItem[] {
    return this.navItems().filter((i) => !i.cta && !i.auth);
  }

  protected authItem(): NavItem | undefined {
    return this.navItems().find((i) => i.auth);
  }

  protected ctaItem(): NavItem | undefined {
    return this.navItems().find((i) => i.cta);
  }
}
