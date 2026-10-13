import { Component, computed, inject, input, output } from '@angular/core';
import { SalonPublicStaffDto } from '../../../api/models/salon-public-staff-dto';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { FavoritesService } from '../../../core/favorites/favorites.service';
import { MediaUrlPipe } from '../../pipes/media-url.pipe';
import { IconComponent } from '../icon/icon.component';

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
  imports: [MediaUrlPipe, IconComponent],
  host: { class: 'block h-full' },
})
export class StaffCardComponent {
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _favorites = inject(FavoritesService);

  readonly staff = input.required<SalonPublicStaffDto>();
  // Omit entirely for a picker with no live-availability meaning (e.g.
  // book-appointment-dialog's staff-picker step) — every card is then
  // selectable with no badge. Surfaces that DO care about right-now
  // availability (salon-landing's Staffs tab, Services drilldown) must still
  // pass a real StaffCardAvailability.
  readonly availability = input<StaffCardAvailability>(NO_AVAILABILITY);
  readonly showHeartButton = input(true);

  readonly select = output<void>();

  // Fallback photo for staff with no uploaded image.
  protected readonly placeholderImage = '/salon-placeholder.jpg';

  protected readonly isLoggedIn = computed(() => !!this._currentUser.user());
  protected readonly showHeart = computed(() => this.isLoggedIn() && this.showHeartButton());
  protected readonly isFavorited = computed(() => this._favorites.isStaffFavorited(this.staff().staffId));

  protected onCardClick(): void {
    if (this.availability().joinable) {
      this.select.emit();
    }
  }

  protected toggleFavorite(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this._favorites.toggleStaff({ staffId: this.staff().staffId });
  }
}
