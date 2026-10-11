import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RoutePath } from '../../core/routing/route-paths';
import { AppPlatformService } from '../../core/native/app-platform.service';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';

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
  imports: [RouterLink, PageHeaderComponent],
})
export class AboutComponent {
  protected readonly platform = inject(AppPlatformService);

  protected readonly registerLink = RoutePath.register();
  protected readonly contactLink = RoutePath.contact();

  protected readonly values: readonly CoreValue[] = [
    {
      number: '01.',
      title: 'Help your business grow',
      body: 'Your public HairMela page helps new clients discover your business. A smoother queue and booking experience also makes it easier for existing clients to come back more often.',
    },
    {
      number: '02.',
      title: 'Respect your clients’ time',
      body: 'Waiting is easier when people know how long it will take. HairMela shows each client their position and estimated wait time, so they can arrive closer to their turn.',
    },
    {
      number: '03.',
      title: 'Made for busy professionals',
      body: 'You can manage HairMela from your phone between clients. Open the queue, call the next person, and get back to work.',
    },
    {
      number: '04.',
      title: 'Keep it simple',
      body: 'You do not need special equipment or a long training session. Set up your business, share your link, and start taking walk-ins and bookings.',
    },
  ];
}
