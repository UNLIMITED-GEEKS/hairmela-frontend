import { Component, computed, input } from '@angular/core';
import { MediaUrlPipe } from '../../pipes/media-url.pipe';

@Component({
  selector: 'app-avatar',
  templateUrl: './avatar.component.html',
  imports: [MediaUrlPipe],
})
export class AvatarComponent {
  readonly src = input<string | null | undefined>(null);
  readonly name = input('');
  readonly size = input<'sm' | 'md' | 'lg' | 'xl'>('md');

  protected readonly initials = computed(() => {
    const parts = this.name().trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0]?.[0]?.toUpperCase() ?? '?';
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
