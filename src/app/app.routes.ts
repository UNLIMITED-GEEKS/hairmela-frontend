import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { guestGuard } from './core/guards/guest.guard';
import { guestShellGuard } from './core/guards/guest-shell.guard';
import { salonRoleGuard } from './core/guards/salon-role.guard';
import { orgOwnerGuard } from './core/guards/org-owner.guard';
import { SalonRole } from './core/salon-context/membership.types';

export const routes: Routes = [
  // ── Public shell — landing, privacy, verify-email, login, register ───────
  {
    path: '',
    loadComponent: () =>
      import('./shared/components/shells/public-shell/public-shell.component').then((m) => m.PublicShellComponent),
    children: [
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
    ],
  },

  // ── Guest shell (path: 'g') ─────────────────────────────────────────────
  {
    path: 'g',
    canActivate: [guestShellGuard],
    loadComponent: () =>
      import('./shared/components/shells/guest-shell/guest-shell.component').then((m) => m.GuestShellComponent),
    children: [
      {
        path: 'queues',
        loadComponent: () =>
          import('./features/queues/guest-queues/guest-queues.component').then((m) => m.GuestQueuesComponent),
      },
      {
        path: 's/:slug',
        data: { shellPrefix: '/g' },
        loadChildren: () =>
          import('./features/visit/visit.routes').then((m) => m.visitRoutes),
      },
    ],
  },

  // ── Auth shell ───────────────────────────────────────────────────────────
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./shared/components/shells/auth-shell/auth-shell.component').then((m) => m.AuthShellComponent),
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'account',
        loadComponent: () =>
          import('./features/account/account.component').then((m) => m.AccountComponent),
      },
      {
        path: 'notifications',
        loadComponent: () =>
          import('./features/notifications/notifications.component').then((m) => m.NotificationsComponent),
      },
      {
        path: 'queues',
        loadComponent: () =>
          import('./features/queues/auth-queues/auth-queues.component').then((m) => m.AuthQueuesComponent),
      },
      {
        path: 's/:slug',
        data: { shellPrefix: '' },
        loadChildren: () =>
          import('./features/visit/visit.routes').then((m) => m.visitRoutes),
      },
      {
        path: 'org/:orgId',
        canActivate: [orgOwnerGuard],
        loadChildren: () =>
          import('./features/organization/organization.routes').then((m) => m.organizationRoutes),
      },
      {
        path: 'salons/new',
        loadComponent: () =>
          import('./features/salons/create-salon/create-salon.component').then((m) => m.CreateSalonComponent),
      },
      {
        path: 'salons/:salonId',
        canActivate: [salonRoleGuard],
        data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
        loadChildren: () =>
          import('./features/salons/salon.routes').then((m) => m.salonRoutes),
      },
      {
        path: 'salons/:salonId/queues/:queueId/console',
        canActivate: [salonRoleGuard],
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
    ],
  },

  { path: '**', redirectTo: '' },
];
