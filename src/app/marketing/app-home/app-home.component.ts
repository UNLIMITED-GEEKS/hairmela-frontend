import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RoutePath } from '../../core/routing/route-paths';
import { IconComponent } from '../../shared/components/icon/icon.component';

// Signed-out landing for app contexts (Capacitor APK, installed PWA, iOS
// standalone) — the marketing site is the wrong first screen once there is no
// browser chrome around it. Chosen by HomeShellComponent; web keeps
// LandingComponent untouched.
//
// Reaching this while signed in is already prevented by guestGuard on the
// route, so there is no auth handling here.
@Component({
  selector: 'app-app-home',
  templateUrl: './app-home.component.html',
  imports: [RouterLink, IconComponent],
})
export class AppHomeComponent {
  protected readonly registerLink = RoutePath.register();
  protected readonly loginLink = RoutePath.login();
  protected readonly searchLink = RoutePath.search();
}
