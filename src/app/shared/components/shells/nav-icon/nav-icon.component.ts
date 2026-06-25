import { Component, input } from '@angular/core';
import { NavIcon } from '../nav-item.types';

@Component({
  selector: 'app-nav-icon',
  templateUrl: './nav-icon.component.html',
})
export class NavIconComponent {
  readonly icon = input.required<NavIcon>();
  readonly size = input<string>('w-5 h-5');
}
