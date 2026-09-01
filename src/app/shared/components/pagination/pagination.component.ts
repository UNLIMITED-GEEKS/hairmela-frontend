import { Component, computed, input, output } from '@angular/core';
import { PaginatedMetaDto } from '../../../api/models/paginated-meta-dto';

// The prev/next arrows use border-STRONG, not border. --color-border is tuned
// for structural chrome — the sidebar edge, a card outline — where it should
// barely register (1.21:1 on the page in dark mode). These are buttons: the
// border IS the button, since there is no fill behind the chevron, so at that
// weight they read as disabled even when they are not. border-strong doubles
// it to 2.46:1.
//
// Single reusable pager against the {data, meta} envelope every paginated list
// endpoint returns identically (listing, favourites, notifications inbox —
// FRONTEND-FAVORITES-LISTING-HANDOFF §5). Build once, use everywhere.
@Component({
  selector: 'app-pagination',
  templateUrl: './pagination.component.html',
})
export class PaginationComponent {
  readonly meta = input.required<PaginatedMetaDto | null>();
  /**
   * Horizontal placement of the pager. Centre everywhere by default — the
   * dashboard is the exception, where the listing is a left-aligned horizontal
   * strip and a centred pager under it looks detached from the row it controls.
   */
  readonly align = input<'center' | 'left'>('center');
  readonly pageChange = output<number>();

  protected readonly visible = computed(() => (this.meta()?.totalPages ?? 0) > 0);

  protected readonly canPrev = computed(() => (this.meta()?.page ?? 1) > 1);
  protected readonly canNext = computed(() => {
    const m = this.meta();
    return !!m && m.page < m.totalPages;
  });

  // A short window of page numbers around the current page — never renders
  // more than a handful of buttons even when totalPages is large.
  protected readonly pageWindow = computed<number[]>(() => {
    const m = this.meta();
    if (!m) return [];
    const span = 2;
    const start = Math.max(1, m.page - span);
    const end = Math.min(m.totalPages, m.page + span);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  });

  protected go(page: number): void {
    this.pageChange.emit(page);
  }
}
