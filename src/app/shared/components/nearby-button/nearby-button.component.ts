import { Component, inject } from '@angular/core';
import { SalonListingService } from '../../../marketing/landing/salon-listing.service';
import { AppPlatformService } from '../../../core/native/app-platform.service';
import { IconComponent } from '../icon/icon.component';

// "Near me" toggle for the salon listing. Shared by the landing page and the
// search page, which both drive the same SalonListingService.
//
// Nearby is a distinct MODE, not another filter — the endpoint takes only
// lat/lng/page — so turning it on clears the text filters and category, and
// setting any of those turns it back off. The service owns that rule; this
// component is just its button.
@Component({
  selector: 'app-nearby-button',
  templateUrl: './nearby-button.component.html',
  imports: [IconComponent],
})
export class NearbyButtonComponent {
  protected readonly listing = inject(SalonListingService);
  // A denial is remembered, so the only way back is settings — and in the
  // installed app "browser settings" is somewhere the user cannot go.
  protected readonly platform = inject(AppPlatformService);

  protected toggle(): void {
    if (this.listing.nearbyActive()) {
      this.listing.disableNearby();
    } else {
      void this.listing.enableNearby();
    }
  }
}
