import { Component, input, computed } from '@angular/core';

export type SkeletonVariant = 'line' | 'circle' | 'card' | 'list-item' | 'avatar-row';

@Component({
  selector: 'app-skeleton',
  templateUrl: './skeleton.component.html',
})
export class SkeletonComponent {
  readonly variant = input<SkeletonVariant>('line');
  readonly count = input<number>(3);
  readonly height = input<string>('');
  readonly width = input<string>('');

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
