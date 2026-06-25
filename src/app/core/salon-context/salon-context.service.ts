import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { Router, NavigationEnd, ActivatedRoute } from '@angular/router';
import { filter, catchError, EMPTY } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MembershipStore } from './membership.store';
import { Membership } from './membership.types';

@Injectable({ providedIn: 'root' })
export class SalonContextService {
  private readonly _router = inject(Router);
  private readonly _root = inject(ActivatedRoute);
  private readonly _membershipStore = inject(MembershipStore);

  private readonly _activeSalonId = signal<string | null>(null);
  private readonly _membership = signal<Membership | null>(null);

  readonly activeSalonId = this._activeSalonId.asReadonly();
  readonly membership = this._membership.asReadonly();
  readonly isFrozen = computed(() => this._membership()?.isFrozen ?? false);

  constructor() {
    this._router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      takeUntilDestroyed(),
    ).subscribe(() => {
      this._activeSalonId.set(this._extractSalonId());
    });

    this._activeSalonId.set(this._extractSalonId());

    effect(() => {
      const salonId = this._activeSalonId();
      if (!salonId) {
        this._membership.set(null);
        return;
      }

      this._membershipStore.getMembership(salonId).pipe(
        catchError(() => {
          this._membership.set(null);
          return EMPTY;
        }),
      ).subscribe((m) => this._membership.set(m));
    });
  }

  private _extractSalonId(): string | null {
    // Walk the activated route tree to find a :salonId param — the router
    // only populates this when the route actually defines it, so static
    // segments like 'new' and 'mine' are never mistaken for IDs.
    let route = this._root.snapshot;
    while (route) {
      if (route.params['salonId']) return route.params['salonId'];
      route = route.firstChild!;
      if (!route) break;
    }

    // Fall back to ?salon= query param (used by the dashboard switcher)
    const salon = this._root.snapshot.queryParamMap.get('salon');
    return salon ?? null;
  }
}
