import { Component, inject, signal, OnInit, DestroyRef } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { GuestStore } from '../../../../core/guest/guest-store';
import { GuestEntryValidatorService } from '../../../../core/guest/guest-entry-validator.service';
import { NavItem } from '../nav-item.types';
import { MobileTopBarComponent } from '../mobile-top-bar/mobile-top-bar.component';
import { BottomNavComponent } from '../bottom-nav/bottom-nav.component';
import { MobileSheetComponent } from '../mobile-sheet/mobile-sheet.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { TopBarComponent } from '../top-bar/top-bar.component';
import { RoutePath } from '../../../../core/routing/route-paths';

@Component({
  selector: 'app-guest-shell',
  templateUrl: './guest-shell.component.html',
  imports: [
    RouterOutlet,
    SidebarComponent,
    TopBarComponent,
    MobileTopBarComponent,
    BottomNavComponent,
    MobileSheetComponent,
  ],
})
export class GuestShellComponent implements OnInit {
  private readonly _guestStore = inject(GuestStore);
  private readonly _validator = inject(GuestEntryValidatorService);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);

  protected readonly sheetOpen = signal(false);

  protected readonly navItems: NavItem[] = [
    { label: 'My Queues', icon: 'queue',      url: RoutePath.guestQueues()[0],  bottomNav: true, sidebar: true, sheet: true },
    { label: 'Sign Up',   icon: 'person-add', url: RoutePath.register()[0],  bottomNav: true, sidebar: true, sheet: true, cta: true },
  ];

  ngOnInit(): void {
    this._validator.validate();

    this._router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      takeUntilDestroyed(this._destroyRef),
    ).subscribe((e) => {
      this._guestStore.setLastPath(e.urlAfterRedirects);
    });
  }
}
