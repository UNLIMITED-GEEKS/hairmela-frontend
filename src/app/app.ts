import { Component, inject, effect } from '@angular/core';
import { RouterOutlet, RouterLink } from '@angular/router';
import { ToastComponent } from './core/toast/toast.component';
import { ConfirmDialogComponent } from './shared/components/confirm-dialog/confirm-dialog.component';
import { AuthService } from './core/auth/auth.service';
import { CurrentUserStore } from './core/auth/current-user.store';
import { InvitesService } from './features/dashboard/invites.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, ToastComponent, ConfirmDialogComponent],
  templateUrl: './app.html',
})
export class App {
  protected readonly _auth = inject(AuthService);
  protected readonly _currentUser = inject(CurrentUserStore);
  protected readonly _invites = inject(InvitesService);

  constructor() {
    effect(() => {
      if (this._currentUser.user()) {
        this._invites.load();
      }
    });
  }
}
