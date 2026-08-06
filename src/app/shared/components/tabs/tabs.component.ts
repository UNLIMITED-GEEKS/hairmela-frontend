import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  QueryList,
  ViewChildren,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';

export interface TabItem {
  readonly id: string;
  readonly label: string;
  // Optional shorter label used below sm: — for tab sets whose full labels
  // don't fit a phone viewport (e.g. how-it-works' "For salon owners"). Both
  // are rendered and swapped by CSS, so the sliding indicator still measures
  // a single row and never needs to re-run on a breakpoint change.
  readonly shortLabel?: string;
}

// Pill-style tabs with a sliding active indicator (measures the active
// button's own offset/width so it works whether tabs are flex-1 or content-sized).
@Component({
  selector: 'app-tabs',
  templateUrl: './tabs.component.html',
})
export class TabsComponent implements AfterViewInit, OnDestroy {
  private _resizeObserver?: ResizeObserver;

  readonly tabs = input.required<TabItem[]>();
  readonly activeId = input.required<string>();
  readonly tabChange = output<string>();
  // false (default) = the row stretches to fill its container, tabs share
  // equal width — the original behavior every existing caller (salon-landing's
  // About/Services/Staffs) already relies on. true = the row sizes to its
  // own content instead, for callers with very different-length labels in a
  // wide/centered container (e.g. how-it-works's "For customers" vs "For
  // salon owners") where equal-width stretching squeezes the longer label.
  readonly fitContent = input(false);

  @ViewChildren('tabBtn') private readonly _tabButtons!: QueryList<ElementRef<HTMLButtonElement>>;

  protected readonly indicatorStyle = signal<Record<string, string>>({ width: '0px', transform: 'translateX(0px)' });

  protected readonly activeIndex = computed(() =>
    this.tabs().findIndex((t) => t.id === this.activeId()),
  );

  constructor() {
    effect(() => {
      // Re-measure whenever the active tab changes (view children are ready by then).
      this.activeIndex();
      queueMicrotask(() => this._measure());
    });
  }

  ngAfterViewInit(): void {
    this._measure();
    this._tabButtons.changes.subscribe(() => this._measure());

    // Button widths change without any Angular-visible event: a viewport
    // resize/rotation, or crossing the sm: breakpoint where a TabItem with a
    // shortLabel swaps to its full label. Without this the indicator keeps
    // the width/offset it measured at the old size and sits off the pill.
    const first = this._tabButtons.first?.nativeElement;
    if (first?.parentElement) {
      this._resizeObserver = new ResizeObserver(() => this._measure());
      this._resizeObserver.observe(first.parentElement);
    }
  }

  ngOnDestroy(): void {
    this._resizeObserver?.disconnect();
  }

  protected select(id: string): void {
    if (id !== this.activeId()) this.tabChange.emit(id);
  }

  private _measure(): void {
    const index = this.activeIndex();
    const btn = this._tabButtons?.get(index)?.nativeElement;
    if (!btn) return;
    this.indicatorStyle.set({
      width: `${btn.offsetWidth}px`,
      transform: `translateX(${btn.offsetLeft}px)`,
    });
  }
}
