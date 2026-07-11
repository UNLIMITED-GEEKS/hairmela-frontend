import { Routes } from '@angular/router';
import { RouteSegment } from '../../core/routing/route-paths';

export const organizationRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./org-overview/org-overview.component').then((m) => m.OrgOverviewComponent),
  },
  {
    path: RouteSegment.SETTINGS,
    loadComponent: () =>
      import('./org-settings/org-settings.component').then((m) => m.OrgSettingsComponent),
  },
  {
    path: RouteSegment.PLAN,
    loadComponent: () =>
      import('./plan-explainer/plan-explainer.component').then((m) => m.PlanExplainerComponent),
  },
  {
    path: RouteSegment.BILLING,
    loadComponent: () =>
      import('./billing/billing.component').then((m) => m.BillingComponent),
  },
  {
    path: `${RouteSegment.BILLING}/${RouteSegment.PAYMENT}/${RouteSegment.CALLBACK}`,
    loadComponent: () =>
      import('./billing/payment-callback.component').then((m) => m.PaymentCallbackComponent),
  },
];
