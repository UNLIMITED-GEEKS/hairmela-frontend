import { Component, inject, input } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { IconComponent } from '../icon/icon.component';

// Reusable back-navigation button — replaces the app's ~9 hand-rolled
// Location.back() buttons. 'plain' matches the existing bare-icon style used
// on white-background pages; 'glass' is a frosted blur circle for use over
// photos (e.g. the salon slug page's gallery header).
@Component({
  selector: 'app-back-button',
  templateUrl: './back-button.component.html',
  imports: [IconComponent],
})
export class BackButtonComponent {
  private readonly _location = inject(Location);
  private readonly _router = inject(Router);

  readonly variant = input<'plain' | 'glass'>('glass');
  // Used only when there's no browser history to go back to (e.g. a
  // deep-linked page opened directly, not navigated to from within the app).
  readonly fallbackRoute = input<string[] | undefined>(undefined);

  protected goBack(): void {
    if (window.history.length > 1) {
      this._location.back();
      return;
    }
    const fallback = this.fallbackRoute();
    if (fallback) {
      this._router.navigate(fallback);
    }
  }
}
