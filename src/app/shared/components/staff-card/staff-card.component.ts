import { Component, input, output } from '@angular/core';
import { SalonPublicStaffDto } from '../../../api/models/salon-public-staff-dto';
import { MediaUrlPipe } from '../../pipes/media-url.pipe';

export interface StaffCardAvailability {
  readonly label: string;
  readonly badgeClasses: string;
  readonly joinable: boolean;
  readonly showBadge: boolean;
}

// No live-availability meaning in a booking-ahead context (picking who to
// book a FUTURE appointment with) — "on break right now" or "closed today"
// says nothing about next Tuesday. Always joinable, no badge.
const NO_AVAILABILITY: StaffCardAvailability = {
  label: '',
  badgeClasses: '',
  joinable: true,
  showBadge: false,
};

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
  // Omit entirely for a picker with no live-availability meaning (e.g.
  // book-appointment-dialog's staff-picker step) — every card is then
  // selectable with no badge. Surfaces that DO care about right-now
  // availability (salon-landing's Staffs tab, Services drilldown) must still
  // pass a real StaffCardAvailability.
  readonly availability = input<StaffCardAvailability>(NO_AVAILABILITY);

  readonly select = output<void>();

  // Fallback photo for staff with no uploaded image.
  protected readonly placeholderImage = '/salon-placeholder.jpg';
}
