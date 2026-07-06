import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MySalonDto } from '../../../api/models/my-salon-dto';

@Component({
  selector: 'app-staff-dashboard',
  templateUrl: './staff-dashboard.component.html',
  imports: [RouterLink],
})
export class StaffDashboardComponent {
  readonly salon = input.required<MySalonDto>();
  readonly myQueueId = input<string | null>(null);
}
