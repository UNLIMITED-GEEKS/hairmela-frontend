import { Component, computed, inject, input } from '@angular/core';
import { ApiConfiguration } from '../../../api/api-configuration';

@Component({
  selector: 'app-avatar',
  templateUrl: './avatar.component.html',
})
export class AvatarComponent {
  private readonly _apiConfig = inject(ApiConfiguration);

  readonly src = input<string | null | undefined>(null);
  readonly name = input('');
  readonly size = input<'sm' | 'md' | 'lg' | 'xl'>('md');

  protected readonly initials = computed(() => {
    const parts = this.name().trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0]?.[0]?.toUpperCase() ?? '?';
  });

  protected readonly resolvedSrc = computed(() => {
    const src = this.src();
    if (!src) return null;
    if (src.startsWith('http')) return src;
    return `${this._apiConfig.rootUrl}${src}`;
  });

  protected readonly sizeClasses = computed(() => {
    switch (this.size()) {
      case 'sm': return 'w-8 h-8 text-xs';
      case 'lg': return 'w-16 h-16 text-xl';
      case 'xl': return 'w-24 h-24 text-2xl';
      default:   return 'w-12 h-12 text-base';
    }
  });
}
