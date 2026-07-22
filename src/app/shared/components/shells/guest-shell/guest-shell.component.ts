import { Component, inject, signal, viewChild, ElementRef, OnInit, AfterViewInit, OnDestroy, DestroyRef } from '@angular/core';
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
import { PullToRefreshIndicatorComponent } from '../../pull-to-refresh-indicator/pull-to-refresh-indicator.component';
import { PullToRefreshService } from '../../../../core/pwa/pull-to-refresh.service';
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
    PullToRefreshIndicatorComponent,
  ],
})
export class GuestShellComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly _guestStore = inject(GuestStore);
  private readonly _validator = inject(GuestEntryValidatorService);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _pullToRefresh = inject(PullToRefreshService);

  // This shell's scroll region is the inner <main>, not the window (see
  // PullToRefreshService's class doc for why that distinction matters).
  private readonly _mainEl = viewChild.required<ElementRef<HTMLElement>>('mainScroll');

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

  ngAfterViewInit(): void {
    this._pullToRefresh.init({ scrollEl: this._mainEl().nativeElement });
  }

  ngOnDestroy(): void {
    this._pullToRefresh.teardown();
  }
}
