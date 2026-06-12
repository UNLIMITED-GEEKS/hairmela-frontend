import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-no-salons-empty-state',
  templateUrl: './no-salons-empty-state.component.html',
})
export class NoSalonsEmptyStateComponent {
  readonly message = input<string>('You have no salons yet.');
  readonly ctaLabel = input<string>('Create a salon');
  readonly ctaClick = output<void>();
}
