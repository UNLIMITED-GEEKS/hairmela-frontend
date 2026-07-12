import { Component, input } from '@angular/core';
import { NavIcon } from '../nav-item.types';
import { IconComponent } from '../../icon/icon.component';

@Component({
  selector: 'app-nav-icon',
  templateUrl: './nav-icon.component.html',
  imports: [IconComponent],
})
export class NavIconComponent {
  readonly icon = input.required<NavIcon>();
  readonly size = input<string>('w-5 h-5');
}
