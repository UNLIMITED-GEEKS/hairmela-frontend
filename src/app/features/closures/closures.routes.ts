import { Routes } from '@angular/router';

export const closuresRoutes: Routes = [
  {
    path: '',
    title: 'Closures',
    loadComponent: () =>
      import('./closures.component').then((m) => m.ClosuresComponent),
  },
];
