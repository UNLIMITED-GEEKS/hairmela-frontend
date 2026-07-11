import { Component, ElementRef, QueryList, ViewChild, ViewChildren, computed, effect, inject, input, output, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { MediaUrlPipe } from '../../pipes/media-url.pipe';

// Full-screen image lightbox: center image + arrows + thumbnail strip, with
// smooth animated swipe (pointer events — no gesture library, no CDK). The
// image track is a horizontal strip translated by -(index * 100%); dragging
// moves it 1:1 with the pointer, releasing animates a snap to the nearest
// image. Scroll-locks the page and traps focus while open.
@Component({
  selector: 'app-gallery-modal',
  templateUrl: './gallery-modal.component.html',
  imports: [MediaUrlPipe],
})
export class GalleryModalComponent {
  private readonly _document = inject(DOCUMENT);

  readonly images = input.required<string[]>();
  readonly open = input.required<boolean>();
  readonly startIndex = input(0);
  readonly closed = output<void>();

  @ViewChild('dialogEl') private readonly _dialogEl?: ElementRef<HTMLElement>;
  @ViewChildren('thumbBtn') private readonly _thumbButtons?: QueryList<ElementRef<HTMLElement>>;

  protected readonly activeIndex = signal(0);

  // Live drag offset in pixels, added on top of the settled -(index * 100%)
  // position while a pointer drag is in progress. 0 and no-transition once released.
  private readonly _dragOffsetPx = signal(0);
  protected readonly dragging = signal(false);

  private _dragStartX = 0;
  private _trackWidthPx = 0;

  protected readonly trackStyle = computed(() => {
    const index = this.activeIndex();
    const dragPx = this._dragOffsetPx();
    return {
      transform: `translate3d(calc(-${index * 100}% + ${dragPx}px), 0, 0)`,
      transition: this.dragging() ? 'none' : 'transform 0.3s ease-out',
    };
  });

  constructor() {
    // Reset to the requested start image and apply scroll-lock/focus-trap
    // every time the modal opens; release the lock when it closes.
    effect(() => {
      if (this.open()) {
        this.activeIndex.set(this._clampIndex(this.startIndex()));
        this._document.body.style.overflow = 'hidden';
        queueMicrotask(() => this._dialogEl?.nativeElement.focus());
      } else {
        this._document.body.style.overflow = '';
      }
    });

    // Keep the active thumbnail scrolled into view — arrows/swipe/keyboard
    // navigation can move activeIndex past what's currently visible in the strip.
    effect(() => {
      const index = this.activeIndex();
      const btn = this._thumbButtons?.get(index)?.nativeElement;
      btn?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
  }

  protected close(): void {
    this.closed.emit();
  }

  protected next(): void {
    this.activeIndex.set(this._clampIndex(this.activeIndex() + 1));
  }

  protected prev(): void {
    this.activeIndex.set(this._clampIndex(this.activeIndex() - 1));
  }

  protected jumpTo(index: number): void {
    this.activeIndex.set(this._clampIndex(index));
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight') this.next();
    else if (event.key === 'ArrowLeft') this.prev();
    else if (event.key === 'Escape') this.close();
    else if (event.key === 'Tab') this._trapTab(event);
  }

  protected onPointerDown(event: PointerEvent, trackEl: HTMLElement): void {
    this.dragging.set(true);
    this._dragStartX = event.clientX;
    this._trackWidthPx = trackEl.offsetWidth;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.dragging()) return;
    this._dragOffsetPx.set(event.clientX - this._dragStartX);
  }

  protected onPointerUp(): void {
    if (!this.dragging()) return;
    const threshold = this._trackWidthPx * 0.2;
    const offset = this._dragOffsetPx();
    if (offset < -threshold) this.next();
    else if (offset > threshold) this.prev();
    this.dragging.set(false);
    this._dragOffsetPx.set(0);
  }

  private _clampIndex(index: number): number {
    const last = this.images().length - 1;
    return Math.max(0, Math.min(index, last));
  }

  // Minimal focus trap: on Tab, when focus would leave the dialog, wrap it
  // back to the first/last focusable element inside instead.
  private _trapTab(event: KeyboardEvent): void {
    const root = this._dialogEl?.nativeElement;
    if (!root) return;
    const focusable = root.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = this._document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
