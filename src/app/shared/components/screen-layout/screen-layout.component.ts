import { Component, input } from '@angular/core';

/**
 * Full-height screen shell with a fixed action bar at the bottom.
 *
 * Usage:
 *   <app-screen-layout>
 *     <ng-container slot="header"><!-- optional sticky header --></ng-container>
 *     <!-- scrollable body content goes here (default slot) -->
 *     <ng-container slot="actions"><!-- buttons that stick to the bottom --></ng-container>
 *   </app-screen-layout>
 */
@Component({
  selector: 'app-screen-layout',
  templateUrl: './screen-layout.component.html',
})
export class ScreenLayoutComponent {
  readonly maxWidth = input<string>('max-w-md');
  readonly noPadding = input<boolean>(false);
}
