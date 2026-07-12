import { Component, input, output } from '@angular/core';
import { Service } from '../../../api/models/service';
import { IconComponent } from '../icon/icon.component';

// Service row on the salon slug page's "Choose service" screen — scissors
// icon, name + description, price + duration.
@Component({
  selector: 'app-service-list-item',
  templateUrl: './service-list-item.component.html',
  imports: [IconComponent],
  host: { class: 'block' },
})
export class ServiceListItemComponent {
  readonly service = input.required<Service>();
  readonly select = output<void>();
}
