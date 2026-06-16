import { Component, inject, input, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MySalonDto } from '../../../api/models/my-salon-dto';
import { MySalonsListComponent } from './my-salons-list/my-salons-list.component';
import { NoSalonsEmptyStateComponent } from '../shared/no-salons-empty-state/no-salons-empty-state.component';

@Component({
  selector: 'app-salon-dashboard',
  templateUrl: './salon-dashboard.component.html',
  imports: [MySalonsListComponent, NoSalonsEmptyStateComponent],
})
export class SalonDashboardComponent implements OnInit {
  readonly initialSalons = input.required<MySalonDto[]>();

  private readonly _router = inject(Router);

  protected readonly salons = signal<MySalonDto[]>([]);

  ngOnInit(): void {
    this.salons.set(this.initialSalons());
  }

  protected navigateToCreateSalon(): void {
    this._router.navigate(['/salons/new']);
  }
}
