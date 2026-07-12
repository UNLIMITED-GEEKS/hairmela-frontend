import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RoutePath } from '../../core/routing/route-paths';

interface LegalSection {
  readonly id: string;
  readonly title: string;
  readonly body: readonly string[];
}

// HairMela privacy policy. Content is static marketing copy; sections render
// from this array so the sticky nav and the body stay in sync from one source.
@Component({
  selector: 'app-privacy',
  templateUrl: './privacy.component.html',
  imports: [RouterLink],
})
export class PrivacyComponent {
  protected readonly lastUpdated = '30 June 2026';
  protected readonly privacyLink = RoutePath.privacy();

  protected readonly sections: readonly LegalSection[] = [
    {
      id: 'overview',
      title: 'Overview',
      body: [
        'HairMela ("HairMela", "we", "us", or "our") has created this privacy policy to explain our commitment to the privacy of the people who use our app and website. Please read the following to learn how we handle the personal information we collect from salon owners, staff, and customers.',
      ],
    },
    {
      id: 'what-this-covers',
      title: 'What this policy covers',
      body: [
        'This policy applies to the information we collect when you create an account, set up a salon, join a queue, or otherwise use the HairMela service.',
        'It does not apply to the practices of businesses we do not own or control — including the salons listed on HairMela, or any third-party services that the app links to.',
      ],
    },
    {
      id: 'information-we-collect',
      title: 'Information we collect',
      body: [
        'You can browse a salon’s public page without an account. To join a queue, manage a salon, or invite staff, we ask for information such as your name, email address, and (optionally) phone number.',
        'When a customer joins a queue, we record the entry so you and the salon can track position and wait time. Salon owners provide business details such as the salon name, address, operating hours, services, and staff.',
        'By providing this information you consent to its collection and use as described in this policy.',
      ],
    },
    {
      id: 'how-we-use-it',
      title: 'How we use your information',
      body: [
        'We use your information to run the service: to create and secure your account, show your live position in a queue, notify you when it’s your turn, let salons manage their queues and staff, and respond to your requests.',
        'If you have enabled notifications, we use your device’s push subscription only to send queue updates such as "it’s your turn". You can turn this off at any time from your account.',
      ],
    },
    {
      id: 'non-personal-information',
      title: 'Non-personal information',
      body: [
        'We automatically receive technical information such as your device type and basic usage data to keep the service reliable and improve it. This information is not linked to your identity.',
      ],
    },
    {
      id: 'sharing-and-disclosure',
      title: 'Information sharing',
      body: [
        'We do not sell your personal information. When you join a queue, the salon you join sees the information needed to serve you (such as your first name and the service you selected).',
        'We may share information with service providers who help us operate HairMela (for example, hosting and push-notification delivery), and only to the extent needed to provide the service.',
      ],
    },
    {
      id: 'security',
      title: 'Security',
      body: [
        'No transmission over the internet can be guaranteed 100% secure, but we protect your information with industry-standard measures including encrypted connections and access controls. We retain your information only as long as needed to provide the service or as required by law.',
      ],
    },
    {
      id: 'your-choices',
      title: 'Your choices',
      body: [
        'You can update your account, leave a queue, turn notifications on or off, and request deletion of your account at any time. If you no longer consent to our use of your information, please contact us and stop using the service.',
      ],
    },
    {
      id: 'changes',
      title: 'Changes to this policy',
      body: [
        'We may update this policy from time to time. Please review it periodically. Your continued use of HairMela after any changes means you accept the updated policy.',
      ],
    },
    {
      id: 'contact',
      title: 'Questions or suggestions',
      body: [
        'If you have questions about this policy or your personal information, email us at hello@contact.hairmela.com.',
      ],
    },
  ];
}
