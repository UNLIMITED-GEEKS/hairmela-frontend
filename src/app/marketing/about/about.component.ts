import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RoutePath } from '../../core/routing/route-paths';

interface CoreValue {
  readonly number: string;
  readonly title: string;
  readonly body: string;
}

// Public "About us" marketing page. Static copy; the core-values list renders
// from an array so the section stays tidy and easy to edit in one place.
@Component({
  selector: 'app-about',
  templateUrl: './about.component.html',
  imports: [RouterLink],
})
export class AboutComponent {
  protected readonly registerLink = RoutePath.register();
  protected readonly contactLink = RoutePath.contact();

  protected readonly values: readonly CoreValue[] = [
    {
      number: '01.',
      title: 'Respect your customer’s time',
      body: 'Standing around guessing when you’ll be seen is the worst part of a haircut. HairMela turns the wait into a number you can watch — so people show up right when it’s their turn, not an hour early.',
    },
    {
      number: '02.',
      title: 'Built for the chair, not the desk',
      body: 'Barbers run their day from a phone between clients, not a back-office computer. Every screen is designed to be glanced at and tapped once — open the queue, call the next client, get back to work.',
    },
    {
      number: '03.',
      title: 'Simple beats clever',
      body: 'No hardware, no training day, no manual. Set up your salon, share a link, and start taking walk-ins. The fastest tool is the one your team actually uses.',
    },
  ];
}
