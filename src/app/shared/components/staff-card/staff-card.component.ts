import { Component, input, output } from '@angular/core';
import { SalonPublicStaffDto } from '../../../api/models/salon-public-staff-dto';
import { MediaUrlPipe } from '../../pipes/media-url.pipe';

export interface StaffCardAvailability {
  readonly label: string;
  readonly badgeClasses: string;
  readonly joinable: boolean;
  readonly showBadge: boolean;
}

// Full-photo staff card — same visual language as SalonCardComponent (photo
// fills the card, glassmorphic availability badge + name bar overlaid),
// used on the salon slug page's Staffs tab and the Services tab's
// barber-drilldown screen.
@Component({
  selector: 'app-staff-card',
  templateUrl: './staff-card.component.html',
  imports: [MediaUrlPipe],
  host: { class: 'block h-full' },
})
export class StaffCardComponent {
  readonly staff = input.required<SalonPublicStaffDto>();
  readonly availability = input.required<StaffCardAvailability>();

  readonly select = output<void>();

  // Fallback photo for staff with no uploaded image.
  protected readonly placeholderImage = '/salon-placeholder.jpg';
}
