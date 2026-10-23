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

// HairMela privacy policy. Content is static marketing copy; sections render
// from this array so the sticky nav and the body stay in sync from one source.
@Component({
  selector: 'app-privacy',
  templateUrl: './privacy.component.html',
  imports: [RouterLink, PageHeaderComponent],
})
export class PrivacyComponent {
  protected readonly platform = inject(AppPlatformService);

  protected readonly lastUpdated = '23 October 2026';
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
        'If you sign in with Google or Apple, we receive your name and email address from that provider (with Apple, you can choose to hide your email address).',
        'If you allow location access, we use your device’s location to show salons near you. You can use HairMela without granting it and search for salons instead.',
        'Messages you send in chat between customers and salons — including text, photos, and voice notes — are stored so they can be delivered and shown in the conversation. Salons and staff may also upload photos to their salon and staff profiles.',
        'If a salon requires a booking fee, you upload a photo of your payment receipt so it can be checked before your place is held.',
        'If you buy a subscription for your salon business, we keep a record of the plan and its status.',
        'By providing this information you consent to its collection and use as described in this policy.',
      ],
    },
    {
      id: 'how-we-use-it',
      title: 'How we use your information',
      body: [
        'We use your information to run the service: to create and secure your account, show your live position in a queue, notify you when it’s your turn, let salons manage their queues and staff, and respond to your requests.',
        'We use chat messages to deliver them between you and the salon, location to show nearby salons, receipt photos to check a booking-fee payment, and subscription records to give your salon the features of its plan.',
        'If you have enabled notifications, we use your device’s push subscription to send updates such as "it’s your turn", new chat messages, and announcements from salons you use. You can turn notifications off at any time in your account or device settings.',
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
      id: 'cookies-and-advertising',
      title: 'Cookies and advertising',
      body: [
        'If you accept optional cookies on our website, we use Meta Pixel to measure visits and understand the effectiveness of our advertising. Meta may receive information about the pages you visit, your browser or device, and related identifiers under its own privacy terms.',
        'We also use TikTok Pixel on our website for the same purpose, under TikTok’s own privacy terms.',
        'Meta Pixel does not load if you reject optional cookies. Neither pixel is used in the HairMela iOS or Android apps, and the apps do not track you across other companies’ apps or websites. You can change your choice by clearing HairMela site data in your browser and choosing again when the cookie banner appears.',
      ],
    },
    {
      id: 'sharing-and-disclosure',
      title: 'Information sharing',
      body: [
        'We do not sell your personal information. When you join a queue, the salon you join sees the information needed to serve you (such as your first name and the service you selected).',
        'We may share information with service providers who help us operate HairMela, and only to the extent needed to provide the service. These include hosting and file storage (for photos and voice notes), Google Firebase (sign-in), Apple and Google (push-notification delivery), and email delivery.',
        'Booking-fee receipt photos are analysed automatically by a third-party AI provider (Anthropic, accessed through OpenRouter) solely to check that the receipt matches the salon’s payment details.',
      ],
    },
    {
      id: 'payments-and-subscriptions',
      title: 'Payments and subscriptions',
      body: [
        'In the iOS app, subscriptions are bought through Apple’s in-app purchase. Apple processes the payment; we never receive your card details. RevenueCat, our subscription provider, receives the purchase record and your organization’s HairMela ID so the plan can be applied to your salon.',
        'On our website, payments are processed by Flutterwave. We receive the payment status, not your full card details.',
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
        'You can update your account, leave a queue, turn notifications on or off, and withdraw location, camera, or microphone access in your device settings at any time.',
        'You can delete your account from Account settings in the app, or by emailing us. Deleting your account removes your profile and personal information, except where we must keep records to meet legal obligations. If you no longer consent to our use of your information, you can delete your account or contact us.',
        'You can block or report a conversation from the chat screen. Reports go to our team, who review them and act on them.',
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
