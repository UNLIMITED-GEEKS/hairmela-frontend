import { Routes } from '@angular/router';

export const organizationRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./org-overview/org-overview.component').then((m) => m.OrgOverviewComponent),
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./org-settings/org-settings.component').then((m) => m.OrgSettingsComponent),
  },
  {
    path: 'plan',
    loadComponent: () =>
      import('./plan-explainer/plan-explainer.component').then((m) => m.PlanExplainerComponent),
  },
];
