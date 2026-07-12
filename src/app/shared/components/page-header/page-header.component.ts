import { Component, input } from '@angular/core';
import { BackButtonComponent } from '../back-button/back-button.component';

/**
 * Reusable page header: back button + title, for use across list/detail
 * pages that currently hand-roll a bare `<h1>` (staff list, salon settings,
 * etc.). Project trailing content (e.g. an action button) via the `actions`
 * slot.
 *
 * Usage:
 *   <app-page-header title="Staff">
 *     <a slot="actions" ...>Add Staff</a>
 *   </app-page-header>
 */
@Component({
  selector: 'app-page-header',
  templateUrl: './page-header.component.html',
  imports: [BackButtonComponent],
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly backVariant = input<'plain' | 'glass'>('plain');
  readonly fallbackRoute = input<string[] | undefined>(undefined);
}
