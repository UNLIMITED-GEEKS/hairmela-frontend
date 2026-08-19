import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../icon/icon.component';
import { RoutePath } from '../../../../core/routing/route-paths';

// Official HairMela accounts. Plain <a href> (not routerLink) — these leave
// the app entirely; `icon` is the filename in public/svgs.
const SOCIAL_LINKS = [
  { icon: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/hairmela_app' },
  { icon: 'tiktok', label: 'TikTok', url: 'https://www.tiktok.com/@hairmela_app' },
  { icon: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/Hairmelaltd' },
  { icon: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/company/hairmela/' },
] as const;

// Public marketing footer — column links, legal, socials, and the HairMela
// wordmark. Rendered once in the public shell so every public page shares it.
// The year is computed in the class (no new Date() in templates, per project
// standards).
@Component({
  selector: 'app-public-footer',
  templateUrl: './public-footer.component.html',
  imports: [RouterLink, IconComponent],
})
export class PublicFooterComponent {
  protected readonly year = 2026;
  protected readonly socialLinks = SOCIAL_LINKS;

  protected readonly pricingLink = RoutePath.pricing();
  protected readonly aboutLink = RoutePath.about();
  protected readonly howToInstallLink = RoutePath.download();
  protected readonly registerLink = RoutePath.register();
  protected readonly loginLink = RoutePath.login();
  protected readonly privacyLink = RoutePath.privacy();
  protected readonly termsLink = RoutePath.terms();
  protected readonly deleteAccountLink = RoutePath.deleteAccount();
  protected readonly contactLink = RoutePath.contact();
}
