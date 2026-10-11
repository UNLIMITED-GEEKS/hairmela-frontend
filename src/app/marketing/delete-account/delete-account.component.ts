import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RoutePath } from '../../core/routing/route-paths';
import { AppPlatformService } from '../../core/native/app-platform.service';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';

// Account-deletion instructions. Publicly reachable WITHOUT signing in,
// deliberately: Google Play requires a deletion URL that a reviewer (and a
// user who has lost access to their account) can open directly, so this route
// carries no auth guard.
//
// Instructions-only for now — there is no self-service delete endpoint yet, so
// the actionable step is a pre-filled email. If a DELETE endpoint is added
// later, put the in-app button here and keep the email path as the fallback
// for users who are locked out.
@Component({
  selector: 'app-delete-account',
  templateUrl: './delete-account.component.html',
  imports: [RouterLink, PageHeaderComponent],
})
export class DeleteAccountComponent {
  protected readonly platform = inject(AppPlatformService);

  protected readonly privacyLink = RoutePath.privacy();
  protected readonly contactLink = RoutePath.contact();

  protected readonly supportEmail = 'hello@contact.hairmela.com';

  // Pre-filled so the request arrives with what support needs to act on it —
  // an email with just "delete my account" and no account identifier costs a
  // round-trip before anything can happen.
  protected readonly mailtoLink =
    `mailto:${this.supportEmail}` +
    '?subject=' + encodeURIComponent('Account deletion request') +
    '&body=' + encodeURIComponent(
      'I would like my HairMela account and associated data deleted.\n\n' +
      'Account email: \n' +
      'Phone number (if any): \n' +
      'Salon name (if you own or work at one): \n\n' +
      'I understand this is permanent and cannot be undone.',
    );
}
