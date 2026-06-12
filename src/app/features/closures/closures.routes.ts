import { Routes } from '@angular/router';

export const closuresRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./closures.component').then((m) => m.ClosuresComponent),
  },
];
