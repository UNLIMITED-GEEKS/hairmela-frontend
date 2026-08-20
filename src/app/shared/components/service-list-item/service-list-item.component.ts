import { Component, input, output } from '@angular/core';
import { Service } from '../../../api/models/service';
import { IconComponent } from '../icon/icon.component';
import { CurrencyNgnPipe } from '../../pipes/currency-ngn.pipe';

// Service row on the salon slug page's "Choose service" screen — scissors
// icon, name + description, price + duration.
@Component({
  selector: 'app-service-list-item',
  templateUrl: './service-list-item.component.html',
  imports: [IconComponent, CurrencyNgnPipe],
  host: { class: 'block' },
})
export class ServiceListItemComponent {
  readonly service = input.required<Service>();
  readonly showPrice = input(true);
  // Passed in rather than read from SalonContextService: this row renders on
  // the PUBLIC salon page, where the viewer has no membership and therefore no
  // salon context. The parent has the salon's currency from the public DTO.
  readonly currency = input<string>('NGN');
  readonly select = output<void>();
}
