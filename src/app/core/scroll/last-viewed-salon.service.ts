import { Injectable, signal } from '@angular/core';

/**
 * Remembers which salon the user last opened from a listing, so that coming
 * back scrolls that card into view instead of dumping them at the top of the
 * list to scroll down again. Same idea as the category pills restoring their
 * own scroll position on return.
 *
 * Deliberately in-memory only (no URL param, no storage): this is a
 * within-session browsing affordance. A reload or app restart is a fresh
 * start, which matches how the listing cache and the pills already behave.
 *
 * Scoped by `surface` rather than stored as a bare id. Search, the landing
 * page, the dashboard and favourites are separate lists that can hold
 * different salons; without the surface key, opening a salon from search then
 * navigating to favourites would make favourites try to restore a card that
 * may not even be in it. Only the surface that recorded the tap restores it.
 */
export type ListingSurface = 'search' | 'landing' | 'dashboard' | 'favorites';

interface LastViewed {
  readonly surface: ListingSurface;
  readonly salonId: string;
}

@Injectable({ providedIn: 'root' })
export class LastViewedSalonService {
  private readonly _lastViewed = signal<LastViewed | null>(null);

  /** Called by the card as it is tapped, before navigation. */
  record(surface: ListingSurface, salonId: string): void {
    this._lastViewed.set({ surface, salonId });
  }

  /**
   * The salon to restore for this surface, or null if it wasn't the one.
   *
   * Reads WITHOUT consuming, for callers that only need to look. Restoring
   * code should use consumeFor() instead — see the note there.
   */
  forSurface(surface: ListingSurface): string | null {
    const last = this._lastViewed();
    return last && last.surface === surface ? last.salonId : null;
  }

  /**
   * Takes the pending restore for this surface, clearing it so it cannot fire
   * again.
   *
   * A restore is a ONE-SHOT instruction: "the user just came back, put this
   * card in view". Leaving it set made it standing state instead, and the
   * listing re-scrolled on every later change to the list — which the user
   * experiences as the strip fighting them, snapping back while they are
   * scrolling it by hand.
   */
  consumeFor(surface: ListingSurface): string | null {
    const salonId = this.forSurface(surface);
    if (salonId) this._lastViewed.set(null);
    return salonId;
  }

  // The scroll offset that put the recorded card in view. Held here rather
  // than on the directive because the listing container is destroyed and
  // rebuilt several times while a page settles — each rebuild gets a fresh
  // directive at scrollLeft 0, so any state kept there is lost exactly when
  // it is needed. Keyed by surface so two listings cannot overwrite each
  // other's position.
  // Keyed by surface AND salon id. Keying by surface alone was a bug: opening
  // a second salon found the FIRST salon's offset, applied it, and returned
  // before ever looking at the new card — so the listing always snapped back
  // to whichever salon was opened first.
  private readonly _offsets = new Map<string, { left: number; top: number }>();

  private _key(surface: ListingSurface, salonId: string): string {
    return `${surface}:${salonId}`;
  }

  rememberOffset(surface: ListingSurface, salonId: string, left: number, top: number): void {
    this._offsets.set(this._key(surface, salonId), { left, top });
  }

  offsetFor(surface: ListingSurface, salonId: string): { left: number; top: number } | null {
    return this._offsets.get(this._key(surface, salonId)) ?? null;
  }

  clear(): void {
    this._lastViewed.set(null);
    this._offsets.clear();
  }
}
