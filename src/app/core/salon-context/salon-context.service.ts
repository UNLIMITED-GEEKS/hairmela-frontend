import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter, switchMap, catchError, EMPTY } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MembershipStore } from './membership.store';
import { Membership } from './membership.types';

@Injectable({ providedIn: 'root' })
export class SalonContextService {
  private readonly _router = inject(Router);
  private readonly _membershipStore = inject(MembershipStore);

  private readonly _activeSalonId = signal<string | null>(null);
  private readonly _membership = signal<Membership | null>(null);

  readonly activeSalonId = this._activeSalonId.asReadonly();
  readonly membership = this._membership.asReadonly();
  readonly isFrozen = computed(() => this._membership()?.isFrozen ?? false);

  constructor() {
    // Watch route changes and extract :salonId from the URL
    this._router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      takeUntilDestroyed(),
    ).subscribe(() => {
      const salonId = this._extractSalonId(this._router.url);
      this._activeSalonId.set(salonId);
    });

    // Set initial value on construction (for direct-load navigation)
    this._activeSalonId.set(this._extractSalonId(this._router.url));

    // Whenever activeSalonId changes, fetch the membership
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

  private _extractSalonId(url: string): string | null {
    const match = url.match(/\/salons\/([^/]+)/);
    return match ? match[1] : null;
  }
}
