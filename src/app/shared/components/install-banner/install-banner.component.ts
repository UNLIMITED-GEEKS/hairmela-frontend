import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { InstallPromptService } from '../../../core/pwa/install-prompt.service';
import { RoutePath } from '../../../core/routing/route-paths';

// Site-wide install nudge, styled to match the About page's closing CTA.
// Rendered once in the public shell, right above the footer, on every public
// page. Hides once the visitor already has HairMela installed — nudging
// someone who's already done it is just noise.
@Component({
  selector: 'app-install-banner',
  templateUrl: './install-banner.component.html',
  imports: [RouterLink],
})
export class InstallBannerComponent {
  protected readonly install = inject(InstallPromptService);
  protected readonly howToInstallLink = RoutePath.dashboard();
}
