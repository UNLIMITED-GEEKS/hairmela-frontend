import { Component, DestroyRef, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { finalize } from 'rxjs';
import { CommentsService } from '../comments.service';
import { CommentResponseDto } from '../../../api/models/comment-response-dto';
import { ErrorCodes } from '../../../core/errors/error-codes';
import { isApiError } from '../../../core/errors/api-error.types';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { GalleryModalComponent } from '../../../shared/components/gallery-modal/gallery-modal.component';

const MAX_BODY_LENGTH = 5000;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Self-contained comment thread + composer for one queue entry. Fully owns
 * its own load/send/error state — nothing it does blocks or reflects onto
 * the host page. Meant to sit inside an accordion (My Position's "View
 * notes", the queue-list row's "Notes") that's collapsed by default; the
 * host expands it and this component takes it from there.
 *
 * No live updates (spec: no sockets, no polling) — the host calls refresh()
 * whenever the accordion opens or a refresh button is pressed; this
 * component doesn't fetch on its own on init, since it may be constructed
 * before the host actually wants data loaded (e.g. inside an @if that only
 * renders when the accordion is open — in which case ngOnInit-style
 * eagerness would be correct too, but an explicit refresh() call keeps the
 * "when does this fetch" decision entirely with the host, matching "expand
 * = refetch" for both surfaces).
 */
@Component({
  selector: 'app-comments-thread',
  templateUrl: './comments-thread.component.html',
  imports: [InlineSpinnerComponent, GalleryModalComponent, DatePipe],
})
export class CommentsThreadComponent {
  private readonly _comments = inject(CommentsService);
  private readonly _destroyRef = inject(DestroyRef);

  readonly queueId = input.required<string>();
  readonly entryId = input.required<string>();
  // My Position vs. queue-list use different empty-state/placeholder copy.
  readonly composerPlaceholder = input('Write a note…');
  readonly emptyLabel = input('No chat yet.');

  // Phone to call from the composer, supplied by the host because each side
  // reads it from a different place: the customer gets the barber's number
  // (falling back to the salon's), the barber gets the client's. Null hides
  // the button entirely — an absence, not a disabled control, since there's
  // nothing the user could do to make a missing number appear.
  readonly callPhone = input<string | null>(null);

  // Fires after a successful post, so a host that also shows an unread badge
  // or similar could react — nothing currently listens, kept for symmetry
  // with the rest of this codebase's optimistic-write components.
  readonly posted = output<CommentResponseDto>();

  protected readonly comments = signal<CommentResponseDto[] | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);

  protected readonly body = signal('');
  protected readonly image = signal<File | null>(null);
  protected readonly imagePreviewUrl = signal<string | null>(null);
  protected readonly sending = signal(false);
  protected readonly sendError = signal<string | null>(null);
  protected readonly closed = signal(false);

  // Tapped comment image, viewed full-screen via the shared gallery modal —
  // one image at a time (a comment carries at most one), so images() is
  // always a single-element array rather than the whole thread's images.
  protected readonly viewerImageUrl = signal<string | null>(null);

  readonly maxBodyLength = MAX_BODY_LENGTH;

  // The scrollable message list — scrolled to the bottom right after a
  // refresh() populates it (so opening the accordion lands on the latest
  // message, not the oldest) and after a successful send (so the new
  // message stays in view).
  private readonly _messageList = viewChild<ElementRef<HTMLElement>>('messageList');

  /** Called by the host every time the thread should (re)load — expand or refresh. */
  refresh(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.loadError.set(null);
    this._comments
      .list(this.queueId(), this.entryId())
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe({
        next: (list) => {
          this.comments.set(list);
          this._scrollToLatest();
        },
        error: (err) => {
          if (this._codeOf(err) === ErrorCodes.COMMENTS_ENTRY_CLOSED) {
            this.closed.set(true);
            this.comments.set([]);
            return;
          }
          this.loadError.set('Could not load notes.');
        },
      });
  }

  protected onImagePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      this.sendError.set('Only JPEG, PNG, or WebP images are allowed.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      this.sendError.set('Image must be 5 MB or smaller.');
      return;
    }

    this.sendError.set(null);
    this._revokePreview();
    this.image.set(file);
    this.imagePreviewUrl.set(URL.createObjectURL(file));
  }

  protected openImageViewer(url: string): void {
    this.viewerImageUrl.set(url);
  }

  protected closeImageViewer(): void {
    this.viewerImageUrl.set(null);
  }

  protected removeImage(): void {
    this._revokePreview();
    this.image.set(null);
  }

  protected canSend(): boolean {
    return !this.sending() && !this.closed() && (this.body().trim().length > 0 || !!this.image());
  }

  protected send(): void {
    if (!this.canSend()) return;

    const body = this.body().trim();
    const image = this.image();
    this.sending.set(true);
    this.sendError.set(null);

    this._comments
      .post(this.queueId(), this.entryId(), { body, image })
      .pipe(
        finalize(() => this.sending.set(false)),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe({
        next: (comment) => {
          this.comments.update((list) => [...(list ?? []), comment]);
          this.body.set('');
          this._revokePreview();
          this.image.set(null);
          this.posted.emit(comment);
          this._scrollToLatest();
        },
        error: (err) => {
          const code = this._codeOf(err);
          if (code === ErrorCodes.COMMENTS_ENTRY_CLOSED) {
            this.closed.set(true);
            this.sendError.set('This conversation has ended.');
          } else if (code === ErrorCodes.COMMENT_TOO_LONG) {
            this.sendError.set(`Note is too long (max ${MAX_BODY_LENGTH} characters).`);
          } else if (code === ErrorCodes.COMMENT_EMPTY) {
            this.sendError.set('Write a note or attach an image.');
          } else if (code === ErrorCodes.RATE_LIMITED) {
            this.sendError.set('Sending too fast — wait a moment and try again.');
          } else if (code === ErrorCodes.COMMENT_IMAGE_INVALID) {
            this.sendError.set('That image could not be attached. Try again.');
          } else {
            // Anything else (network, 5xx, etc.) already gets a toast from
            // the global error interceptor — no need to duplicate it here.
            this.sendError.set('Could not send. Please try again.');
          }
        },
      });
  }

  private _codeOf(err: unknown): string | null {
    const body = (err as { error?: unknown })?.error;
    return isApiError(body) ? body.code : null;
  }

  // setTimeout(0), not queueMicrotask: the @for list re-renders off the
  // comments signal write above, and that DOM update isn't guaranteed done
  // by the next microtask — a macrotask reliably lands after Angular has
  // flushed the render.
  private _scrollToLatest(): void {
    setTimeout(() => {
      const el = this._messageList()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  private _revokePreview(): void {
    const url = this.imagePreviewUrl();
    if (url) URL.revokeObjectURL(url);
    this.imagePreviewUrl.set(null);
  }
}
