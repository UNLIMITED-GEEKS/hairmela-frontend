import { Injectable, inject, signal, computed, effect, Signal, WritableSignal } from '@angular/core';
import { Router, NavigationEnd, ActivatedRoute } from '@angular/router';
import { filter, catchError, EMPTY } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MembershipStore } from './membership.store';
import { Membership } from './membership.types';
import { PersistentStore } from '../storage/persistent-store';
import { CacheRegistry } from '../caching/cache-registry/cache-registry.service';
import { RouteParam, RouteQueryParam } from '../routing/route-paths';

export const LAST_SALON_KEY = 'hm_last_selected_salon_id';

@Injectable({ providedIn: 'root' })
export class SalonContextService {
  private readonly _router = inject(Router);
  private readonly _root = inject(ActivatedRoute);
  private readonly _membershipStore = inject(MembershipStore);
  private readonly _persistentStore = inject(PersistentStore);
  private readonly _cacheRegistry = inject(CacheRegistry);

  private readonly _activeSalonId = signal<string | null>(null);
  private readonly _membership = signal<Membership | null>(null);
  private readonly _displayMembership = signal<Membership | null>(null);

  // Last salon the user was actually in (route-derived), persisted across
  // navigations to pages that carry no salon in their URL at all (Dashboard,
  // Favourites, Search, Account). This is a DISPLAY preference only — the
  // top bar / sidebar dropdown reads `displaySalonId` so it doesn't appear to
  // "forget" the selection on those pages. It must never be used for
  // permissions/gating: `activeSalonId` (below) stays strictly route-derived
  // for that, so isFrozen/tier/staffFrozen etc. correctly go inert the moment
  // the user is genuinely outside any salon-scoped route.
  private readonly _lastSelectedSalonId = signal<string | null>(
    this._persistentStore.get<string>(LAST_SALON_KEY),
  );

  readonly activeSalonId = this._activeSalonId.asReadonly();
  readonly displaySalonId = computed(() => this._activeSalonId() ?? this._lastSelectedSalonId());
  readonly membership = this._membership.asReadonly();
  // Membership for displaySalonId — lets shell-level nav (sidebar "Controls"
  // section) keep showing Staff/Services/Settings links for the last-visited
  // salon on pages with no salon in the URL. Never used for gating page
  // content/tier banners — those stay on the strict `membership` above.
  readonly displayMembership = this._displayMembership.asReadonly();
  readonly isFrozen = computed(() => this._membership()?.isFrozen ?? false);

  // ── Tier / subscription derived state (single source for banners + gates) ──
  readonly tier = computed(() => this._membership()?.tier ?? 0);
  readonly status = computed(() => this._membership()?.status ?? null);
  readonly isTrialing = computed(() => this._membership()?.isTrialing ?? false);
  readonly daysLeft = computed(() => this._membership()?.daysLeft ?? null);
  readonly staffFrozen = computed(() => this._membership()?.staffFrozen ?? false);
  // Floor / no-access: the whole app is read-only when the effective tier is 0.
  readonly isReadOnly = computed(() => this.tier() === 0);

  constructor() {
    this._cacheRegistry.register(this);

    this._router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      takeUntilDestroyed(),
    ).subscribe(() => {
      this._activeSalonId.set(this._extractSalonId());
    });

    this._activeSalonId.set(this._extractSalonId());

    this._bindMembership(this._activeSalonId, this._membership);
    this._bindMembership(this.displaySalonId, this._displayMembership);

    // Remember the last salon actually visited (route-derived) so
    // displaySalonId can keep showing it on pages with no salon in their
    // URL. Deliberately one-directional: only writes when activeSalonId is
    // real, never clears on navigating away — that's the whole point.
    effect(() => {
      const salonId = this._activeSalonId();
      if (!salonId) return;
      this._lastSelectedSalonId.set(salonId);
      this._persistentStore.set(LAST_SALON_KEY, salonId);
    });
  }

  // Fetches membership for whatever salon id `salonId` currently points to,
  // writing it into `target` (null on no-id or fetch error). Shared by both
  // the strict `activeSalonId` binding and the `displaySalonId` binding so
  // adding a third membership consumer is a one-line call, not a copy-paste.
  private _bindMembership(salonId: Signal<string | null>, target: WritableSignal<Membership | null>): void {
    effect(() => {
      const id = salonId();
      if (!id) {
        target.set(null);
        return;
      }

      this._membershipStore.getMembership(id).pipe(
        catchError(() => {
          target.set(null);
          return EMPTY;
        }),
      ).subscribe((m) => target.set(m));
    });
  }

  // CacheRegistry.clearAll() hook — logout wipes the persisted last-selected
  // salon unconditionally, so the next login (possibly a different user on a
  // shared browser, or the same user with no salons left) never redirects
  // into a stale id.
  clear(): void {
    this._lastSelectedSalonId.set(null);
    this._persistentStore.remove(LAST_SALON_KEY);
  }

  // Only clears if the persisted id is the one being invalidated — e.g. a
  // salon just got deleted (clear so login doesn't redirect into a 404'd
  // salon again), or salonRoleGuard just failed to load this exact salon
  // (self-heals a stale id after a single bad redirect instead of looping on
  // every future login). Deleting/failing on a DIFFERENT salon than the one
  // persisted must not clear it — that salon may still be perfectly valid.
  clearIfMatches(salonId: string): void {
    if (this._lastSelectedSalonId() !== salonId) return;
    this.clear();
  }

  private _extractSalonId(): string | null {
    // Walk the activated route tree to find a :salonId param — the router
    // only populates this when the route actually defines it, so static
    // segments like 'new' and 'mine' are never mistaken for IDs.
    let route = this._root.snapshot;
    while (route) {
      if (route.params[RouteParam.SALON_ID]) return route.params[RouteParam.SALON_ID];
      route = route.firstChild!;
      if (!route) break;
    }

    // Fall back to ?salon= query param (used by the dashboard switcher)
    const salon = this._root.snapshot.queryParamMap.get(RouteQueryParam.SALON);
    return salon ?? null;
  }
}
