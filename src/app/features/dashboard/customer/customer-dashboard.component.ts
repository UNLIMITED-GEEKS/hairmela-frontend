import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-customer-dashboard',
  templateUrl: './customer-dashboard.component.html',
  imports: [RouterLink],
})
export class CustomerDashboardComponent {
  readonly firstName = input<string>('');
}
