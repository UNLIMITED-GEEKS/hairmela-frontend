import { Injectable } from '@angular/core';

/**
 * Remembers how far a horizontally-scrolling salon listing was scrolled, so
 * that opening a salon and coming back resumes browsing from that spot rather
 * than from the far left.
 *
 * WHY THIS IS NEEDED AT ALL: the listing lives inside an @if that toggles on a
 * loading flag, so returning to the page destroys the strip and renders a new
 * one. A brand-new element always starts at scrollLeft 0 — the browser has
 * nothing to preserve. Saving the offset ourselves is the only way it survives.
 *
 * Deliberately in-memory only (no URL param, no storage): this is a
 * within-session browsing affordance, and a reload is a fresh start — matching
 * how the listing cache and the category pills already behave.
 *
 * Keyed by surface because each strip is independent and must not overwrite
 * another's position. Search on mobile splits its results across two rows that
 * scroll separately, hence the -top/-bottom pair; favourites and search on
 * desktop are vertical grids with no horizontal position to remember, so they
 * have no key at all.
 */
export type ListingSurface =
  | 'search'
  | 'search-top'
  | 'search-bottom'
  | 'landing'
  | 'dashboard';

@Injectable({ providedIn: 'root' })
export class ListingScrollStore {
  private readonly _offsets = new Map<ListingSurface, number>();

  /**
   * Saves the strip's current offset. Called as a card is tapped — i.e. the
   * moment before navigating away.
   */
  save(surface: ListingSurface, scrollLeft: number): void {
    if (scrollLeft > 0) this._offsets.set(surface, scrollLeft);
    else this._offsets.delete(surface);
  }

  /**
   * Takes the saved offset, clearing it so it can only be applied once.
   *
   * One-shot by design: a restore is the instruction "the user just came
   * back", not standing state. An earlier version left it set, and the strip
   * re-scrolled on every later change to the list — felt as the list fighting
   * the user while they scrolled it by hand.
   */
  take(surface: ListingSurface): number | null {
    const offset = this._offsets.get(surface);
    if (offset === undefined) return null;
    this._offsets.delete(surface);
    return offset;
  }

  clear(): void {
    this._offsets.clear();
  }
}
