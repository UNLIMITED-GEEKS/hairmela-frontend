import { Routes } from '@angular/router';

export const visitRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./salon-shell/salon-shell.component').then((m) => m.SalonShellComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./salon-landing/salon-landing.component').then((m) => m.SalonLandingComponent),
      },
      {
        path: 'q/:queueId',
        loadComponent: () =>
          import('./live-queue/live-queue.component').then((m) => m.LiveQueueComponent),
      },
      {
        path: 'q/:queueId/joining',
        loadComponent: () =>
          import('./joining-queue/joining-queue.component').then((m) => m.JoiningQueueComponent),
      },
      {
        path: 'q/:queueId/join',
        loadComponent: () =>
          import('./join-queue/join-queue.component').then((m) => m.JoinQueueComponent),
      },
      {
        path: 'q/:queueId/e/:entryId/position',
        loadComponent: () =>
          import('./my-position/my-position.component').then((m) => m.MyPositionComponent),
      },
    ],
  },
];
