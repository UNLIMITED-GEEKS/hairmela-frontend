import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-landing',
  templateUrl: './landing.component.html',
  imports: [RouterLink],
})
export class LandingComponent {
  protected readonly steps = [
    {
      number: '1',
      title: 'Set up your salon',
      description: 'Add your salon details, invite barbers, and define your services in minutes.',
    },
    {
      number: '2',
      title: 'Share your queue link',
      description: 'Customers scan your QR code or tap your link to see your live queue.',
    },
    {
      number: '3',
      title: 'Serve clients smoothly',
      description: 'Call the next client, track service time, and manage walk-ins from your phone.',
    },
  ];
}
