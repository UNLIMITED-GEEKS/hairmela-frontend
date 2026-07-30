import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { guestGuard } from './core/guards/guest.guard';
import { guestShellGuard } from './core/guards/guest-shell.guard';
import { salonRoleGuard } from './core/guards/salon-role.guard';
import { orgOwnerGuard } from './core/guards/org-owner.guard';
import { SalonRole } from './core/salon-context/membership.types';
import { RouteParam, RouteSegment } from './core/routing/route-paths';

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
        path: RouteSegment.PRIVACY,
        loadComponent: () =>
          import('./marketing/privacy/privacy.component').then((m) => m.PrivacyComponent),
      },
      {
        path: RouteSegment.PRICING,
        loadComponent: () =>
          import('./marketing/pricing/pricing.component').then((m) => m.PricingComponent),
      },
      {
        path: RouteSegment.DOWNLOAD,
        loadComponent: () =>
          import('./marketing/how-to-install/how-to-install.component').then(
            (m) => m.HowToInstallComponent,
          ),
      },
      {
        path: RouteSegment.TERMS,
        loadComponent: () =>
          import('./marketing/terms/terms.component').then((m) => m.TermsComponent),
      },
      {
        path: RouteSegment.CONTACT,
        loadComponent: () =>
          import('./marketing/contact/contact.component').then((m) => m.ContactComponent),
      },
      {
        path: RouteSegment.ABOUT,
        loadComponent: () =>
          import('./marketing/about/about.component').then((m) => m.AboutComponent),
      },
      {
        path: RouteSegment.VERIFY_EMAIL,
        loadComponent: () =>
          import('./features/auth/verify-email/verify-email.component').then(
            (m) => m.VerifyEmailComponent,
          ),
      },
      {
        // The emailed link uses {FRONTEND_URL}/auth/verify-email?token= (same
        // convention as reset-password). Public — clickable while logged out.
        path: RouteSegment.AUTH_VERIFY_EMAIL,
        loadComponent: () =>
          import('./features/auth/verify-email/verify-email.component').then(
            (m) => m.VerifyEmailComponent,
          ),
      },
      {
        path: RouteSegment.LOGIN,
        canActivate: [guestGuard],
        loadComponent: () =>
          import('./features/auth/login/login.component').then((m) => m.LoginComponent),
      },
      {
        path: RouteSegment.REGISTER,
        canActivate: [guestGuard],
        loadComponent: () =>
          import('./features/auth/register/register.component').then((m) => m.RegisterComponent),
      },
      {
        path: RouteSegment.FORGOT_PASSWORD,
        canActivate: [guestGuard],
        loadComponent: () =>
          import('./features/auth/forgot-password/forgot-password.component').then(
            (m) => m.ForgotPasswordComponent,
          ),
      },
      {
        // Public — the emailed token is the authorization, reachable even if
        // a stale session exists, so no guestGuard.
        path: RouteSegment.AUTH_RESET_PASSWORD,
        loadComponent: () =>
          import('./features/auth/reset-password/reset-password.component').then(
            (m) => m.ResetPasswordPageComponent,
          ),
      },
      {
        // Public — resolves the invite token (no auth); handles logged-in and
        // logged-out invitees inline, so no guard.
        path: RouteSegment.ACCEPT_INVITE,
        loadComponent: () =>
          import('./features/staff/accept-invite/accept-invite.component').then(
            (m) => m.AcceptInviteComponent,
          ),
      },
    ],
  },

  // ── Guest shell (path: 'g') ─────────────────────────────────────────────
  {
    path: RouteSegment.G,
    canActivate: [guestShellGuard],
    loadComponent: () =>
      import('./shared/components/shells/guest-shell/guest-shell.component').then(
        (m) => m.GuestShellComponent,
      ),
    children: [
      {
        path: RouteSegment.QUEUES,
        loadComponent: () =>
          import('./features/queues/guest-queues/guest-queues.component').then(
            (m) => m.GuestQueuesComponent,
          ),
      },
      {
        path: `${RouteSegment.S}/:${RouteParam.SLUG}`,
        data: { shellPrefix: '/g' },
        loadChildren: () => import('./features/visit/visit.routes').then((m) => m.visitRoutes),
      },
      {
        path: `${RouteSegment.BRANCHES}/:${RouteParam.SLUG}`,
        loadChildren: () =>
          import('./features/visit/branches.routes').then((m) => m.branchesRoutes),
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
        path: RouteSegment.DASHBOARD,
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: RouteSegment.ACCOUNT,
        loadComponent: () =>
          import('./features/account/account.component').then((m) => m.AccountComponent),
      },
      {
        path: `${RouteSegment.ACCOUNT}/${RouteSegment.EDIT_PROFILE}`,
        loadComponent: () =>
          import('./features/account/edit-profile/edit-profile.component').then(
            (m) => m.EditProfileComponent,
          ),
      },
      {
        path: RouteSegment.NOTIFICATIONS,
        loadComponent: () =>
          import('./features/notifications/notifications.component').then(
            (m) => m.NotificationsComponent,
          ),
      },
      {
        path: RouteSegment.QUEUES,
        loadComponent: () =>
          import('./features/queues/auth-queues/auth-queues.component').then(
            (m) => m.AuthQueuesComponent,
          ),
      },
      {
        path: RouteSegment.FAVORITES,
        loadComponent: () =>
          import('./features/favorites/favorites-page.component').then(
            (m) => m.FavoritesPageComponent,
          ),
      },
      {
        path: RouteSegment.SEARCH,
        loadComponent: () =>
          import('./features/search/search.component').then((m) => m.SearchComponent),
      },
      {
        path: `${RouteSegment.S}/:${RouteParam.SLUG}`,
        data: { shellPrefix: '' },
        loadChildren: () => import('./features/visit/visit.routes').then((m) => m.visitRoutes),
      },
      {
        path: `${RouteSegment.BRANCHES}/:${RouteParam.SLUG}`,
        loadChildren: () =>
          import('./features/visit/branches.routes').then((m) => m.branchesRoutes),
      },
      {
        path: `${RouteSegment.ORG}/:${RouteParam.ORG_ID}`,
        canActivate: [orgOwnerGuard],
        loadChildren: () =>
          import('./features/organization/organization.routes').then((m) => m.organizationRoutes),
      },
      {
        path: `${RouteSegment.SALONS}/${RouteSegment.NEW}`,
        loadComponent: () =>
          import('./features/salons/create-salon/create-salon.component').then(
            (m) => m.CreateSalonComponent,
          ),
      },
      {
        path: `${RouteSegment.SALONS}/:${RouteParam.SALON_ID}`,
        canActivate: [salonRoleGuard],
        data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
        loadChildren: () => import('./features/salons/salon.routes').then((m) => m.salonRoutes),
      },
      {
        path: `${RouteSegment.SALONS}/:${RouteParam.SALON_ID}/${RouteSegment.QUEUES}/:${RouteParam.QUEUE_ID}/${RouteSegment.CONSOLE}`,
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
            path: RouteSegment.QUEUE,
            loadComponent: () =>
              import('./features/queue/queue-list/queue-list.component').then(
                (m) => m.QueueListComponent,
              ),
          },
        ],
      },
    ],
  },

  {
    path: '**',
    loadComponent: () =>
      import('./marketing/not-found/not-found.component').then((m) => m.NotFoundComponent),
  },
];
