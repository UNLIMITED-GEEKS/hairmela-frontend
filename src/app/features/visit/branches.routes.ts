import { Routes } from '@angular/router';

// A multi-branch root's location picker — mounted at /branches/:slug (auth
// shell) and /g/branches/:slug (guest shell), separate from /s/:slug's visit
// flow. See branch-picker.component.ts for why this is its own page rather
// than something SalonVisitService discovers mid-visit.
export const branchesRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./branch-picker/branch-picker.component').then((m) => m.BranchPickerComponent),
  },
];
