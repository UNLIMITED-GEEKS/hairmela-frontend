import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MySalonDto } from '../../../api/models/my-salon-dto';

@Component({
  selector: 'app-owner-admin-dashboard',
  templateUrl: './owner-admin-dashboard.component.html',
  imports: [RouterLink],
})
export class OwnerAdminDashboardComponent {
  readonly salon = input.required<MySalonDto>();
  readonly myQueueId = input<string | null>(null);
}
