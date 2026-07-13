import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CurrentUserStore } from '../../core/auth/current-user.store';
import { RoutePath } from '../../core/routing/route-paths';

@Component({
  selector: 'app-not-found',
  templateUrl: './not-found.component.html',
  imports: [RouterLink],
})
export class NotFoundComponent {
  private readonly _currentUser = inject(CurrentUserStore);

  protected readonly homeLink = computed(() =>
    this._currentUser.user() ? RoutePath.dashboard() : RoutePath.root(),
  );
}
