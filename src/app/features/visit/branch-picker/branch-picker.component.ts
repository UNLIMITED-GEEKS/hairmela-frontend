import { Component, computed, effect, inject, untracked } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { BranchPickerService } from './branch-picker.service';
import { SalonCardComponent } from '../../../shared/components/salon-card/salon-card.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { RouteParam, RouteQueryParam } from '../../../core/routing/route-paths';

// Its own top-level page (/branches/:slug, /g/branches/:slug), not part of
// the /s/:slug visit flow — /s/:slug always shows that salon's own real page
// now (see SalonVisitService), so this fetches independently via
// BranchPickerService rather than being fed a picker DTO discovered
// mid-visit. Only ever linked to from a listing card that already knows
// hasBranches is true (see salon-card.component.ts's detailLink).
@Component({
  selector: 'app-branch-picker',
  templateUrl: './branch-picker.component.html',
  imports: [SalonCardComponent, PageHeaderComponent, SkeletonComponent],
})
export class BranchPickerComponent {
  protected readonly branchPicker = inject(BranchPickerService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _location = inject(Location);

  // Reactive, not snapshot — same reasoning as SalonShellComponent: this
  // route can in principle be navigated between two different picker slugs
  // without a full reload, and a one-time ngOnInit snapshot read would go
  // stale under Angular's default route reuse.
  private readonly _paramMap = toSignal(this._route.paramMap, { requireSync: true });
  private readonly _slug = computed(() => this._paramMap().get(RouteParam.SLUG) ?? '');

  // The category the customer was filtering by arrives on this page's own URL
  // (the listing card appends it to the /branches link too) and has to be
  // handed on to the branch cards — otherwise picking a branch loses the
  // category, and the branch's salon page opens with nothing expanded.
  private readonly _queryParamMap = toSignal(this._route.queryParamMap, { requireSync: true });
  protected readonly activeCategory = computed(
    () => this._queryParamMap().get(RouteQueryParam.CATEGORY) ?? '',
  );

  constructor() {
    effect(() => {
      const slug = this._slug();
      untracked(() => this.branchPicker.load(slug));
    });
  }

  protected retry(): void {
    this.branchPicker.load(this._slug());
  }

  protected goBack(): void {
    this._location.back();
  }
}
