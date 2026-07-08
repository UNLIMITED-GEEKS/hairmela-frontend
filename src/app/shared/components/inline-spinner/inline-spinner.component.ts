import { Component, input } from '@angular/core';

/**
 * Small inline loading spinner for optimistic-update pending state — sits next
 * to a row/control that stays visible while its action is in flight. Reusable
 * anywhere an optimistic mutation needs a "waiting on the server" affordance.
 */
@Component({
  selector: 'app-inline-spinner',
  templateUrl: './inline-spinner.component.html',
})
export class InlineSpinnerComponent {
  // Tailwind size classes for the spinner (width + height). Defaults to a
  // row-inline size; pass e.g. 'w-5 h-5' for a larger one.
  readonly sizeClass = input('w-4 h-4');
  // Accessible label announced to screen readers while the spinner shows.
  readonly label = input('Saving');
}
