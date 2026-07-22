import { Component, inject, computed } from '@angular/core';
import { PullToRefreshService } from '../../../core/pwa/pull-to-refresh.service';

// Purely presentational — no gesture logic of its own. Renders an arrow that
// rotates as the user drags (idle/pulling), flips to a spinner once past
// threshold (ready/refreshing), driven entirely by PullToRefreshService's
// signals. Fixed to the top of whichever shell mounts it; the service itself
// no-ops outside iOS standalone, so on Android/desktop pullDistance() stays
// 0 and this renders nothing.
@Component({
  selector: 'app-pull-to-refresh-indicator',
  templateUrl: './pull-to-refresh-indicator.component.html',
})
export class PullToRefreshIndicatorComponent {
  protected readonly _service = inject(PullToRefreshService);

  protected readonly pullState = this._service.pullState;

  // Clamp the visible travel so the indicator doesn't drift arbitrarily far
  // down on a long drag — it settles at a max offset once well past ready.
  protected readonly pullOffset = computed(() => Math.min(this._service.pullDistance(), 90));
}
