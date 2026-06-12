import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { guestGuard } from './core/guards/guest.guard';
import { salonRoleGuard } from './core/guards/salon-role.guard';
import { orgOwnerGuard } from './core/guards/org-owner.guard';
import { SalonRole } from './core/salon-context/membership.types';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },

  // Guest-only
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

  // Public
  {
    path: 'verify-email',
    loadComponent: () =>
      import('./features/auth/verify-email/verify-email.component').then((m) => m.VerifyEmailComponent),
  },

  // Authenticated
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

  // Organization
  {
    path: 'org/:orgId',
    canActivate: [authGuard, orgOwnerGuard],
    loadChildren: () =>
      import('./features/organization/organization.routes').then((m) => m.organizationRoutes),
  },

  // Salons
  {
    path: 'salons/new',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/salons/create-salon/create-salon.component').then((m) => m.CreateSalonComponent),
  },
  {
    path: 'salons/:salonId',
    canActivate: [authGuard, salonRoleGuard],
    data: { roles: [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF] },
    loadChildren: () =>
      import('./features/salons/salon.routes').then((m) => m.salonRoutes),
  },

  // Customer-facing visit pages
  {
    path: 's/:slug',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./features/visit/visit.routes').then((m) => m.visitRoutes),
  },

  // Catch-all
  { path: '**', redirectTo: 'dashboard' },
];
