import { Routes } from '@angular/router';

export const visitRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./salon-visit/salon-visit.component').then((m) => m.SalonVisitComponent),
  },
  {
    path: 'q/:queueId',
    loadComponent: () =>
      import('./salon-visit/salon-visit.component').then((m) => m.SalonVisitComponent),
  },
];
