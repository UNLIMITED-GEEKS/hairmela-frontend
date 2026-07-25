import { Component, OnDestroy, inject, computed, effect, untracked } from '@angular/core';
import { RouterOutlet, ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { SalonVisitService } from '../salon-visit.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { ConnectionBannerComponent } from '../../../shared/components/connection-banner/connection-banner.component';
import { RouteParam } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-salon-shell',
  templateUrl: './salon-shell.component.html',
  imports: [RouterOutlet, SkeletonComponent, ConnectionBannerComponent],
})
export class SalonShellComponent implements OnDestroy {
  protected readonly visit = inject(SalonVisitService);
  private readonly _route = inject(ActivatedRoute);

  // Reactive, not snapshot-based — s/:slug is a single route, so navigating
  // between two slugs under it (e.g. a branch-picker card to its own branch's
  // slug) reuses this component instance under Angular's default route reuse
  // and never re-runs ngOnInit; only the paramMap actually updates, which is
  // why this must be a signal derived from it rather than a one-time
  // snapshot read (the bug this replaces: a picker→branch click would have
  // silently kept showing the picker's stale state).
  private readonly _paramMap = toSignal(this._route.paramMap, { requireSync: true });
  private readonly _slug = computed(() => this._paramMap().get(RouteParam.SLUG) ?? '');

  constructor() {
    effect(() => {
      const slug = this._slug();
      const shellPrefix = this._route.snapshot.data['shellPrefix'] ?? '';
      // init() reads this.visit.salonData() internally (its same-slug-skip
      // guard) — untracked so that read doesn't also become a dependency of
      // THIS effect, which would make it re-fire on every salonData write
      // (i.e. every completed fetch) and call init() right back. See
      // BookAppointmentDialogComponent for the same effect-tracking gotcha.
      untracked(() => this.visit.init(slug, shellPrefix));
    });
  }

  ngOnDestroy(): void {
    this.visit.destroy();
  }
}
