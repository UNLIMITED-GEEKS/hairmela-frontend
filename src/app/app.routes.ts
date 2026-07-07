import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { guestGuard } from './core/guards/guest.guard';
import { guestShellGuard } from './core/guards/guest-shell.guard';
import { salonRoleGuard } from './core/guards/salon-role.guard';
import { orgOwnerGuard } from './core/guards/org-owner.guard';
import { canCreateSalonGuard } from './core/guards/can-create-salon.guard';
import { SalonRole } from './core/salon-context/membership.types';

export const routes: Routes = [
  // ── Public shell — landing, privacy, verify-email, login, register ───────
  {
    path: '',
    loadComponent: () =>
      import('./shared/components/shells/public-shell/public-shell.component').then(
        (m) => m.PublicShellComponent,
      ),
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
        path: 'pricing',
        loadComponent: () =>
          import('./marketing/pricing/pricing.component').then((m) => m.PricingComponent),
      },
      {
        path: 'how-to-install',
        loadComponent: () =>
          import('./marketing/how-to-install/how-to-install.component').then(
            (m) => m.HowToInstallComponent,
          ),
      },
      {
        path: 'terms',
        loadComponent: () =>
          import('./marketing/terms/terms.component').then((m) => m.TermsComponent),
      },
      {
        path: 'contact',
        loadComponent: () =>
          import('./marketing/contact/contact.component').then((m) => m.ContactComponent),
      },
      {
        path: 'about',
        loadComponent: () =>
          import('./marketing/about/about.component').then((m) => m.AboutComponent),
      },
      {
        path: 'verify-email',
        loadComponent: () =>
          import('./features/auth/verify-email/verify-email.component').then(
            (m) => m.VerifyEmailComponent,
          ),
      },
      {
        // The emailed link uses {FRONTEND_URL}/auth/verify-email?token= (same
        // convention as reset-password). Public — clickable while logged out.
        path: 'auth/verify-email',
        loadComponent: () =>
          import('./features/auth/verify-email/verify-email.component').then(
            (m) => m.VerifyEmailComponent,
          ),
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
      {
        path: 'forgot-password',
        canActivate: [guestGuard],
        loadComponent: () =>
          import('./features/auth/forgot-password/forgot-password.component').then(
            (m) => m.ForgotPasswordComponent,
          ),
      },
      {
        // Public — the emailed token is the authorization, reachable even if
        // a stale session exists, so no guestGuard.
        path: 'auth/reset-password',
        loadComponent: () =>
          import('./features/auth/reset-password/reset-password.component').then(
            (m) => m.ResetPasswordPageComponent,
          ),
      },
      {
        // Public — resolves the invite token (no auth); handles logged-in and
        // logged-out invitees inline, so no guard.
        path: 'staff/accept-invite',
        loadComponent: () =>
          import('./features/staff/accept-invite/accept-invite.component').then(
            (m) => m.AcceptInviteComponent,
          ),
      },
    ],
  },

  // ── Guest shell (path: 'g') ─────────────────────────────────────────────
  {
    path: 'g',
    canActivate: [guestShellGuard],
    loadComponent: () =>
      import('./shared/components/shells/guest-shell/guest-shell.component').then(
        (m) => m.GuestShellComponent,
      ),
    children: [
      {
        path: 'queues',
        loadComponent: () =>
          import('./features/queues/guest-queues/guest-queues.component').then(
            (m) => m.GuestQueuesComponent,
          ),
      },
      {
        path: 's/:slug',
        data: { shellPrefix: '/g' },
        loadChildren: () => import('./features/visit/visit.routes').then((m) => m.visitRoutes),
      },
    ],
  },

  // ── Auth shell ───────────────────────────────────────────────────────────
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./shared/components/shells/auth-shell/auth-shell.component').then(
        (m) => m.AuthShellComponent,
      ),
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
        path: 'account/edit-profile',
        loadComponent: () =>
          import('./features/account/edit-profile/edit-profile.component').then(
            (m) => m.EditProfileComponent,
          ),
      },
      {
        path: 'notifications',
        loadComponent: () =>
          import('./features/notifications/notifications.component').then(
            (m) => m.NotificationsComponent,
          ),
      },
      {
        path: 'queues',
        loadComponent: () =>
          import('./features/queues/auth-queues/auth-queues.component').then(
            (m) => m.AuthQueuesComponent,
          ),
      },
      {
        path: 'favorites',
        loadComponent: () =>
          import('./features/favorites/favorites-page.component').then(
            (m) => m.FavoritesPageComponent,
          ),
      },
      {
        path: 's/:slug',
        data: { shellPrefix: '' },
        loadChildren: () => import('./features/visit/visit.routes').then((m) => m.visitRoutes),
      },
      {
        path: 'org/:orgId',
        canActivate: [orgOwnerGuard],
        loadChildren: () =>
          import('./features/organization/organization.routes').then((m) => m.organizationRoutes),
      },
      {
        path: 'salons/new',
        canActivate: [canCreateSalonGuard],
        loadComponent: () =>
          import('./features/salons/create-salon/create-salon.component').then(
            (m) => m.CreateSalonComponent,
          ),
      },
      {
        path: 'salons/:salonId',
        canActivate: [salonRoleGuard],
        data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
        loadChildren: () => import('./features/salons/salon.routes').then((m) => m.salonRoutes),
      },
      {
        path: 'salons/:salonId/queues/:queueId/console',
        canActivate: [salonRoleGuard],
        data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
        loadComponent: () =>
          import('./features/queue/queue-shell/queue-shell.component').then(
            (m) => m.QueueShellComponent,
          ),
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/queue/current-client/current-client.component').then(
                (m) => m.CurrentClientComponent,
              ),
          },
          {
            path: 'queue',
            loadComponent: () =>
              import('./features/queue/queue-list/queue-list.component').then(
                (m) => m.QueueListComponent,
              ),
          },
        ],
      },
    ],
  },

  { path: '**', redirectTo: '' },
];
