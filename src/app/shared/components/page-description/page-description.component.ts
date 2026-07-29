import { Component, input } from '@angular/core';

/**
 * A short explanatory line under a page's header/title — the plain-text
 * `<p class="text-sm text-gray-500">` pattern already hand-rolled per page
 * (create-salon, salon-slug, ...), pulled out so new pages reuse it instead
 * of retyping the same classes.
 *
 * Usage:
 *   <app-page-description>
 *     Add a specific date your salon won't be open. Users won't be able to
 *     join queues or book for that day.
 *   </app-page-description>
 *
 * Defaults to mb-6 (matches create-salon/salon-slug's own spacing) so it
 * always has visible breathing room below it, even as the first child of a
 * space-y-* wrapper (which only spaces elements AFTER the first — the exact
 * gap this default is covering for). Override via `extraClass` when a page
 * wants different spacing — named to avoid any ambiguity with the native
 * `class` attribute, and bound explicitly in the template rather than
 * relying on Angular's host/attribute class merging.
 *   <app-page-description extraClass="mb-2">...</app-page-description>
 */
@Component({
  selector: 'app-page-description',
  templateUrl: './page-description.component.html',
})
export class PageDescriptionComponent {
  readonly extraClass = input('mb-6');
}
