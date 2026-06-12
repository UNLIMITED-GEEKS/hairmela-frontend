import { Routes } from '@angular/router';

export const schedulesRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./weekly-schedule.component').then((m) => m.WeeklyScheduleComponent),
  },
];
