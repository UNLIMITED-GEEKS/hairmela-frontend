import {
  DestroyRef,
  Directive,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
} from '@angular/core';
import { ListingScrollStore, ListingSurface } from '../../core/scroll/listing-scroll.store';

/**
 * Keeps a horizontally-scrolling salon listing where the user left it.
 *
 * Put it on the element that scrolls — the one carrying `overflow-x-auto`:
 *
 *   <div class="flex gap-3 overflow-x-auto"
 *        appListingScrollMemory
 *        surface="dashboard"
 *        [items]="listing.items()">
 *
 * The user swipes the row, taps a salon, and comes back; without this the row
 * is a freshly rendered element sitting at 0 and they have to swipe all the
 * way back. (The browser cannot preserve it for us: the listing lives inside
 * an @if that toggles on a loading flag, so returning renders a NEW element.)
 *
 * Two lines of behaviour:
 *
 *   - a pointerdown anywhere in the strip saves the current offset, because
 *     that gesture is either the tap that navigates away or the start of a
 *     scroll — and in both cases the last saved value is the one wanted;
 *   - the first render of a NEW strip applies the saved offset once.
 *
 * WHY WRITING IS SAFE HERE, when earlier attempts felt like the list snapping:
 * the write happens only on a strip that has just been created and never
 * touched. There is no momentum to interrupt, because the element did not
 * exist a frame ago. Any user input permanently disqualifies the strip.
 */
@Directive({
  selector: '[appListingScrollMemory]',
})
export class ListingScrollMemoryDirective {
  readonly surface = input.required<ListingSurface>();

  /**
   * The rendered list. Passed as the array itself, not a count: the effect
   * needs a dependency that genuinely changes when the list does, and a plain
   * number silently disables the feature if a caller passes a constant.
   */
  readonly items = input.required<readonly unknown[]>();

  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _injector = inject(Injector);
  private readonly _store = inject(ListingScrollStore);
  private readonly _destroyRef = inject(DestroyRef);

  /**
   * Whether this directive may still write to the strip.
   *
   * ONE flag rather than a pair of "already applied" / "user took over"
   * booleans: both answer the same question, and keeping two in step is the
   * seam a later edit gets wrong. It starts true and only ever flips false —
   * whether because the restore has been spent or because the user has taken
   * hold of the strip, the answer afterwards is identical.
   */
  private _canRestore = true;

  /**
   * The surface, mirrored out of the input.
   *
   * The pointerdown listener can fire on the first frame, before Angular has
   * bound inputs — reading a required input there throws. Rather than catching
   * that, the effect (which by definition runs with inputs bound) keeps this
   * field current, and the listener reads the field.
   */
  private _surface: ListingSurface | null = null;

  constructor() {
    const strip = this._host.nativeElement;

    // pointerdown covers both meanings: it is the tap that navigates away, and
    // it is the start of a swipe. Saving on it means the stored offset is
    // always "where the strip was when the user last acted", with no need to
    // observe navigation or wire anything into the card.
    const onPointerDown = () => {
      // The strip is the user's from here, even if this fires before inputs
      // are bound and there is no surface to save under yet.
      this._canRestore = false;
      if (this._surface) this._store.save(this._surface, strip.scrollLeft);
    };
    // Passive: this only observes, and must add nothing to the scroll path.
    strip.addEventListener('pointerdown', onPointerDown, { passive: true });
    this._destroyRef.onDestroy(() => strip.removeEventListener('pointerdown', onPointerDown));

    effect(() => {
      this._surface = this.surface();
      const items = this.items();
      if (items.length === 0 || !this._canRestore) return;

      // Deferred to after the render that actually lays the cards out —
      // scrollLeft cannot be set beyond a width the strip does not have yet.
      afterNextRender(() => this._applySavedOffset(), { injector: this._injector });
    });
  }

  private _applySavedOffset(): void {
    const surface = this._surface;
    if (!this._canRestore || !surface) return;

    const strip = this._host.nativeElement;
    // Only ever an untouched strip. A non-zero offset means something else
    // already positioned it, and overwriting that is exactly the class of
    // surprise this directive must not cause.
    if (strip.scrollLeft !== 0) return;

    const saved = this._store.take(surface);
    if (saved === null) return;

    this._canRestore = false;
    strip.scrollLeft = saved;
  }
}
