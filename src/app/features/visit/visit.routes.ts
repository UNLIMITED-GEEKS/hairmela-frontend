import { Routes } from '@angular/router';
import { RouteParam, RouteSegment } from '../../core/routing/route-paths';

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
        path: `${RouteSegment.Q}/:${RouteParam.QUEUE_ID}`,
        loadComponent: () =>
          import('./live-queue/live-queue.component').then((m) => m.LiveQueueComponent),
      },
      {
        path: `${RouteSegment.Q}/:${RouteParam.QUEUE_ID}/${RouteSegment.JOINING}`,
        loadComponent: () =>
          import('./joining-queue/joining-queue.component').then((m) => m.JoiningQueueComponent),
      },
      {
        path: `${RouteSegment.Q}/:${RouteParam.QUEUE_ID}/${RouteSegment.E}/:${RouteParam.ENTRY_ID}/${RouteSegment.POSITION}`,
        loadComponent: () =>
          import('./my-position/my-position.component').then((m) => m.MyPositionComponent),
      },
    ],
  },
];
