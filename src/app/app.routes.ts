import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { guestGuard } from './core/guards/guest.guard';
import { salonRoleGuard } from './core/guards/salon-role.guard';
import { orgOwnerGuard } from './core/guards/org-owner.guard';
import { membershipResolver } from './core/resolvers/membership.resolver';
import { SalonRole } from './core/salon-context/membership.types';

const publicRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./marketing/landing/landing.component').then((m) => m.LandingComponent),
  },
  {
    path: 'privacy',
    loadComponent: () =>
      import('./marketing/privacy/privacy.component').then((m) => m.PrivacyComponent),
  },
  {
    path: 'verify-email',
    loadComponent: () =>
      import('./features/auth/verify-email/verify-email.component').then((m) => m.VerifyEmailComponent),
  },
  {
    path: 's/:slug',
    loadChildren: () =>
      import('./features/visit/visit.routes').then((m) => m.visitRoutes),
  },
];

const guestRoutes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/register/register.component').then((m) => m.RegisterComponent),
  },
];

const authedRoutes: Routes = [
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'account',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/account/account.component').then((m) => m.AccountComponent),
  },
  {
    path: 'notifications',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/notifications/notifications.component').then((m) => m.NotificationsComponent),
  },
  {
    path: 'org/:orgId',
    canActivate: [authGuard, orgOwnerGuard],
    loadChildren: () =>
      import('./features/organization/organization.routes').then((m) => m.organizationRoutes),
  },
  {
    path: 'salons/new',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/salons/create-salon/create-salon.component').then((m) => m.CreateSalonComponent),
  },
  {
    path: 'salons/:salonId',
    canActivate: [authGuard],
    resolve: { membership: membershipResolver },
    loadChildren: () =>
      import('./features/salons/salon.routes').then((m) => m.salonRoutes),
  },
  {
    path: 'salons/:salonId/queues/:queueId/console',
    canActivate: [authGuard, salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
    loadComponent: () =>
      import('./features/queue/queue-shell/queue-shell.component').then((m) => m.QueueShellComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/queue/current-client/current-client.component').then((m) => m.CurrentClientComponent),
      },
      {
        path: 'queue',
        loadComponent: () =>
          import('./features/queue/queue-list/queue-list.component').then((m) => m.QueueListComponent),
      },
    ],
  },
];

export const routes: Routes = [
  ...publicRoutes,
  ...guestRoutes,
  ...authedRoutes,
  { path: '**', redirectTo: '' },
];
