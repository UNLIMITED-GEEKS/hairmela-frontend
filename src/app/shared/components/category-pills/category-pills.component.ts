import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { CategoryResponseDto } from '../../../api/models/category-response-dto';

// Reusable "All" + category chip row — shared by the dashboard and the
// marketing landing page listing so both stay visually identical. Dumb/
// presentational: the caller owns the selected category and the fetch.
//
// The ONE thing it owns is scroll position, because it owns the scrolling
// element. Categories far along the row (Nails, say) are off-screen at rest,
// so returning from a salon with that filter still applied showed an
// apparently unfiltered row — the selected pill was correct but invisible,
// and the user had to scroll to find out what was selected.
@Component({
  selector: 'app-category-pills',
  templateUrl: './category-pills.component.html',
})
export class CategoryPillsComponent {
  readonly categories = input.required<CategoryResponseDto[]>();
  readonly selected = input<string>('');

  readonly select = output<string>();

  private readonly _injector = inject(Injector);
  private readonly _scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  constructor() {
    // Tracks `selected` AND `categories`: on return from a salon the filter is
    // restored before the pills have loaded, so scrolling at that moment would
    // find nothing to scroll to. Re-running once categories arrive fixes it.
    effect(() => {
      const selected = this.selected();
      const hasCategories = this.categories().length > 0;
      if (!selected || !hasCategories) return;
      this._scrollSelectedIntoView();
    });
  }

  // afterNextRender rather than requestAnimationFrame: rAF fires on the next
  // frame, which is only *usually* after Angular has rendered the pills — a
  // timing guess that silently skips the scroll when it loses. This waits for
  // the actual render, and no-ops on the server.
  private _scrollSelectedIntoView(): void {
    afterNextRender(
      () => {
        const container = this._scroller()?.nativeElement;
        const pill = container?.querySelector<HTMLElement>('[data-selected="true"]');
        if (!container || !pill) return;

        // ALREADY VISIBLE — do nothing. This effect also fires when the user
        // TAPS a pill, and yanking the row to centre a chip they just tapped
        // is an unrequested jump. Only scroll when the selection genuinely
        // cannot be seen, which is the restore-from-navigation case this
        // exists for.
        const left = pill.offsetLeft - container.scrollLeft;
        if (left >= 0 && left + pill.offsetWidth <= container.clientWidth) return;

        // Centre it rather than scrollIntoView({inline:'nearest'}): nearest
        // leaves the pill flush against an edge, which reads as "there is
        // nothing past this". Centring shows the neighbours either side, so
        // the row still looks scrollable.
        const target = pill.offsetLeft - container.clientWidth / 2 + pill.offsetWidth / 2;
        container.scrollTo({
          left: Math.max(0, target),
          // 'auto' on restore: this is not a gesture the user made, and
          // animating a jump they did not ask for looks like a glitch.
          behavior: 'auto',
        });
      },
      { injector: this._injector },
    );
  }
}
