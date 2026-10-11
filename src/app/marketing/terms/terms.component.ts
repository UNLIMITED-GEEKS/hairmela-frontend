import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RoutePath } from '../../core/routing/route-paths';
import { AppPlatformService } from '../../core/native/app-platform.service';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';

interface LegalSection {
  readonly id: string;
  readonly title: string;
  readonly body: readonly string[];
}

// HairMela terms of use. Static marketing copy; sections render from this array
// so the sticky nav and the body stay in sync from one source.
@Component({
  selector: 'app-terms',
  templateUrl: './terms.component.html',
  imports: [RouterLink, PageHeaderComponent],
})
export class TermsComponent {
  protected readonly platform = inject(AppPlatformService);

  protected readonly lastUpdated = '30 June 2026';
  protected readonly termsLink = RoutePath.terms();

  protected readonly sections: readonly LegalSection[] = [
    {
      id: 'terms',
      title: 'Terms of Use',
      body: [
        'These terms apply to all use of HairMela ("HairMela", "we", "us", or "our"). The terms "you" and "your" refer to anyone who creates an account, sets up a salon, joins a queue, or otherwise uses the service.',
        'We may revise these terms from time to time, so please review them whenever you use HairMela. By using the service in any way — browsing a salon page, joining a queue, or managing a salon — you confirm that you have read, understood, and agreed to these terms and our privacy policy.',
      ],
    },
    {
      id: 'eligibility-and-accounts',
      title: 'Accounts and eligibility',
      body: [
        'You are responsible for the accuracy of the information on your account and for keeping your login details secure. You agree not to use HairMela for any unlawful purpose or in any way that could harm the service or other users.',
        'Salon owners are responsible for the information they publish — salon details, services, operating hours, and staff — and for keeping it up to date.',
      ],
    },
    {
      id: 'service-scope',
      title: 'What HairMela provides',
      body: [
        'HairMela is a walk-in queue tool for salons. Salons set up their business, staff, services, and hours; customers sign in, join a staff’s line, and watch their position update live.',
        'HairMela connects customers with salons but does not provide the haircare services itself. The salon you join is solely responsible for the service it delivers. We do not verify or guarantee any salon’s availability, quality, or conduct.',
      ],
    },
    {
      id: 'queues-and-no-shows',
      title: 'Queues and no-shows',
      body: [
        'Joining a queue reserves your place in line; it is not a fixed appointment. Position and estimated wait times are calculated from the salon’s live queue and are best-effort estimates, not guarantees.',
        'A salon may mark you as a no-show or cancel your entry according to its own policies — for example, if you are not present when it’s your turn. You can leave a queue at any time before you are served.',
      ],
    },
    {
      id: 'subscriptions-and-billing',
      title: 'Plans and billing',
      body: [
        'Salon owners may subscribe to a paid plan. Upgrades take effect immediately. Downgrades and cancellations take effect at the end of the current billing period — you keep your current plan until then.',
        'If a plan’s limits are exceeded (for example, more salons or staff than the plan allows), the extra items become read-only ("frozen") rather than deleted, and are restored when you upgrade. No data is lost.',
      ],
    },
    {
      id: 'notifications',
      title: 'Notifications',
      body: [
        'If you enable notifications, HairMela may send you queue updates such as "it’s your turn". You can turn notifications off at any time from your account or your device settings.',
      ],
    },
    {
      id: 'third-parties',
      title: 'Third-party links',
      body: [
        'HairMela may contain links to websites or services operated by others, provided for convenience only. We do not control them and are not responsible for their content or practices.',
      ],
    },
    {
      id: 'disclaimer',
      title: 'Disclaimer and termination',
      body: [
        'HairMela is provided "as is". To the extent permitted by law, we are not liable for any loss arising from the use of the service or from any service provided by a salon listed on it.',
        'We reserve the right to suspend or terminate any account at our discretion if these terms are violated or if an account poses a risk to us or our users.',
      ],
    },
    {
      id: 'contact',
      title: 'Contact',
      body: ['Questions about these terms? Email us at hello@contact.hairmela.com.'],
    },
  ];
}
