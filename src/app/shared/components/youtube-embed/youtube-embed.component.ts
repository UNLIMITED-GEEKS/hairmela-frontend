import { Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

// Privacy-enhanced (youtube-nocookie.com) embed, no autoplay — a tutorial
// video shouldn't start playing sound the instant the page/section scrolls
// into view. videoId is the bare id (e.g. "f7moHNUH_jU" from
// youtube.com/shorts/f7moHNUH_jU), not a full URL.
@Component({
  selector: 'app-youtube-embed',
  templateUrl: './youtube-embed.component.html',
})
export class YoutubeEmbedComponent {
  private readonly _sanitizer = inject(DomSanitizer);

  readonly videoId = input.required<string>();
  readonly title = input('Video');
  // Shorts/phone recordings are vertical (9/16); a normal upload is
  // landscape (16/9) — caller picks based on the actual source video.
  readonly aspect = input<'9/16' | '16/9'>('16/9');

  // controls=0 hides YouTube's play bar/scrubber chrome — a deliberate
  // tradeoff: the viewer loses seeking and the visible play/pause button,
  // keeping only tap-anywhere-on-the-video to toggle play. Fine for a short
  // tutorial meant to be watched straight through, not scrubbed.
  protected readonly safeUrl = computed<SafeResourceUrl>(() =>
    this._sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.youtube-nocookie.com/embed/${this.videoId()}?controls=0`,
    ),
  );

  protected readonly aspectClass = computed(() =>
    this.aspect() === '9/16' ? 'aspect-[9/16]' : 'aspect-[16/9]',
  );
}
