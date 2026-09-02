import { Component, input, computed } from '@angular/core';

export type SkeletonVariant =
  | 'line'
  | 'circle'
  | 'card'
  | 'list-item'
  | 'avatar-row'
  /**
   * One plain rectangle, sized by width/height and with a controllable corner
   * radius. Exists so a page can compose a skeleton that matches its own
   * layout — a hero image, a button, a grid tile — WITHOUT hand-writing
   * .skeleton-pulse divs. Keeping every placeholder inside this component
   * means the shimmer, its colours and any future change to them live in one
   * place rather than being copied across a dozen templates.
   */
  | 'block';

@Component({
  selector: 'app-skeleton',
  templateUrl: './skeleton.component.html',
  // A custom element defaults to display:inline, which silently breaks every
  // layout utility a parent applies to it — space-y-* skips inline children, so
  // stacked skeletons collapsed onto each other with no gap, and flex sizing
  // like flex-1 had nothing to size. Block makes the host behave like the div
  // it replaced.
  host: { class: 'block' },
})
export class SkeletonComponent {
  readonly variant = input<SkeletonVariant>('line');
  readonly count = input<number>(3);
  readonly height = input<string>('');
  readonly width = input<string>('');
  /** Tailwind rounding utility for the `block` variant, e.g. 'rounded-full'. */
  readonly rounded = input<string>('rounded-lg');

  protected readonly items = computed(() => Array.from({ length: this.count() }));

  protected readonly lineStyle = computed(() => {
    const h = this.height();
    const w = this.width();
    const styles: Record<string, string> = {};
    if (h) styles['height'] = h;
    if (w) styles['width'] = w;
    return styles;
  });
}
