import { inject, Injectable, linkedSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AppHeaderService {
  private readonly _router = inject(Router);
  private readonly _navigationEnd = toSignal(
    this._router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)),
    { initialValue: null },
  );

  readonly state = linkedSignal(() => {
    this._navigationEnd();
    let route: ActivatedRouteSnapshot | null = this._router.routerState.snapshot.root;
    let title = 'HairMela';
    let backFallback: string[] | undefined;
    let isHome = false;
    let mobileHeader = true;

    while (route) {
      if (route.title) title = route.title;
      if (route.data['backFallback']) backFallback = route.data['backFallback'];
      if (route.data['headerHome'] !== undefined) isHome = route.data['headerHome'];
      if (route.data['mobileHeader'] !== undefined) mobileHeader = route.data['mobileHeader'];
      route = route.firstChild;
    }

    return { title, backFallback, isHome, mobileHeader };
  });
}
