import { Component, computed, input, output } from '@angular/core';
import { PaginatedMetaDto } from '../../../api/models/paginated-meta-dto';

// Single reusable pager against the {data, meta} envelope every paginated list
// endpoint returns identically (listing, favourites, notifications inbox —
// FRONTEND-FAVORITES-LISTING-HANDOFF §5). Build once, use everywhere.
@Component({
  selector: 'app-pagination',
  templateUrl: './pagination.component.html',
})
export class PaginationComponent {
  readonly meta = input.required<PaginatedMetaDto | null>();
  readonly pageChange = output<number>();

  protected readonly visible = computed(() => (this.meta()?.totalPages ?? 0) > 1);

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
