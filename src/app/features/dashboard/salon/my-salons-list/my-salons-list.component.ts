import { Component, input } from '@angular/core';
import { Router } from '@angular/router';
import { inject } from '@angular/core';
import { MySalonDto } from '../../../../api/models/my-salon-dto';

@Component({
  selector: 'app-my-salons-list',
  templateUrl: './my-salons-list.component.html',
})
export class MySalonsListComponent {
  readonly salons = input.required<MySalonDto[]>();

  private readonly _router = inject(Router);

  protected navigateToSalon(salonId: string): void {
    this._router.navigate(['/salons', salonId]);
  }

  protected navigateToConsole(salonId: string): void {
    this._router.navigate(['/salons', salonId]);
  }

  protected roleLabel(role: MySalonDto['role']): string {
    const labels: Record<MySalonDto['role'], string> = {
      OWNER: 'Owner',
      ADMIN: 'Admin',
      STAFF: 'Staff',
    };
    return labels[role];
  }

  protected roleBadgeClass(role: MySalonDto['role']): string {
    const classes: Record<MySalonDto['role'], string> = {
      OWNER: 'bg-primary/10 text-primary',
      ADMIN: 'bg-blue-100 text-blue-700',
      STAFF: 'bg-gray-100 text-gray-600',
    };
    return classes[role];
  }
}
