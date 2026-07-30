import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RoutePath } from '../../../../core/routing/route-paths';

// Public marketing footer — column links, legal, and the HairMela wordmark.
// Rendered once in the public shell so every public page shares it. The year is
// computed in the class (no new Date() in templates, per project standards).
@Component({
  selector: 'app-public-footer',
  templateUrl: './public-footer.component.html',
  imports: [RouterLink],
})
export class PublicFooterComponent {
  protected readonly year = 2026;

  protected readonly pricingLink = RoutePath.pricing();
  protected readonly aboutLink = RoutePath.about();
  protected readonly howToInstallLink = RoutePath.dashboard();
  protected readonly registerLink = RoutePath.register();
  protected readonly loginLink = RoutePath.login();
  protected readonly privacyLink = RoutePath.privacy();
  protected readonly termsLink = RoutePath.terms();
  protected readonly contactLink = RoutePath.contact();
}
