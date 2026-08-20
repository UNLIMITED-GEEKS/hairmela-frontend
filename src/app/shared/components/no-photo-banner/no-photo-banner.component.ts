import { Component, computed, effect, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonMediaService } from '../../../features/salons/salon-media/salon-media.service';
import { StaffMediaService } from '../../../features/staff/staff-media/staff-media.service';
import { SalonRole } from '../../../core/salon-context/membership.types';
import { RoutePath } from '../../../core/routing/route-paths';

// Nudges the viewer to finish whichever photos are THEIRS to add. A salon or
// staff member with no images looks abandoned to a customer browsing, so
// this is the setup step most worth chasing once the salon exists.
//
// TWO AUDIENCES, TWO TARGETS:
//   OWNER/ADMIN → the SALON's photos  (salon profile image + salon gallery)
//   STAFF       → their OWN photos    (their headshot + their work gallery)
// Staff cannot upload salon-level media, so pointing them at the salon media
// page would be a CTA they cannot act on.
//
// TWO SEPARATE GAPS, not one. A PROFILE image is what represents the salon (or
// staff member) in listings and search; GALLERY images are the work samples. Adding
// a gallery photo does not give you a profile image — an earlier version
// tested "any media at all" and went silent the moment one gallery photo
// appeared, while the profile image was still missing.
//
// At most ONE banner shows at a time: with nothing uploaded both gaps are
// real, but stacking two banners on a new salon reads as nagging.
@Component({
  selector: 'app-no-photo-banner',
  templateUrl: './no-photo-banner.component.html',
  imports: [RouterLink],
})
export class NoPhotoBannerComponent {
  private readonly _salonContext = inject(SalonContextService);
  private readonly _salonMedia = inject(SalonMediaService);
  private readonly _staffMedia = inject(StaffMediaService);

  private readonly _role = computed(() => this._salonContext.membership()?.role);
  private readonly _staffId = computed(() => this._salonContext.membership()?.staffId ?? null);

  protected readonly isStaff = computed(() => this._role() === SalonRole.STAFF);

  private readonly _manages = computed(
    () => this._role() === SalonRole.OWNER || this._role() === SalonRole.ADMIN,
  );

  // Staff need a staffId to have anything to link to; without one there is no
  // page to send them to, so stay silent rather than render a dead button.
  private readonly _applies = computed(
    () => this._manages() || (this.isStaff() && !!this._staffId()),
  );

  constructor() {
    // Both services are root-provided with their own per-id cache, so these
    // share state with the media pages rather than duplicating a fetch. Only
    // the relevant one loads, and only for a viewer who can act on it.
    effect(() => {
      if (!this._applies()) return;

      if (this.isStaff()) {
        const staffId = this._staffId();
        if (staffId) this._staffMedia.load(staffId);
        return;
      }

      const salonId = this._salonContext.activeSalonId();
      if (salonId) this._salonMedia.load(salonId);
    });
  }

  private readonly _media = computed(() =>
    this.isStaff() ? this._staffMedia.media() : this._salonMedia.media(),
  );

  // Requires loading to have SETTLED. Without it the banner flashes on every
  // visit while the request is in flight, including where photos do exist.
  private readonly _ready = computed(() => {
    if (!this._applies()) return false;
    return this.isStaff() ? !this._staffMedia.loading() : !this._salonMedia.loading();
  });

  protected readonly needsProfile = computed(
    () => this._ready() && !this._media().some((m) => m.type === 'PROFILE'),
  );

  protected readonly needsGallery = computed(
    () => this._ready() && !this.needsProfile() && !this._media().some((m) => m.type === 'GALLERY'),
  );

  protected readonly mediaLink = computed(() => {
    const salonId = this._salonContext.activeSalonId() ?? '';
    const staffId = this._staffId();
    return this.isStaff() && staffId
      ? RoutePath.salonStaffMedia(salonId, staffId)
      : RoutePath.salonMedia(salonId);
  });
}
