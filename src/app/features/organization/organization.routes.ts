import { Routes } from '@angular/router';

export const organizationRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./org-overview/org-overview.component').then((m) => m.OrgOverviewComponent),
  },
];
