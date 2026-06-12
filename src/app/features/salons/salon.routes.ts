import { Routes } from '@angular/router';

export const salonRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./salon-overview/salon-overview.component').then((m) => m.SalonOverviewComponent),
  },
];
