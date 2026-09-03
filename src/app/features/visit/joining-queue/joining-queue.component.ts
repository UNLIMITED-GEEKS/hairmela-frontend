import { Component, OnDestroy, inject, effect, signal, computed } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { SalonVisitService } from '../salon-visit.service';
import { ToastService } from '../../../core/toast/toast.service';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';

/**
 * Rotating wait copy. The FIRST line is the plain, factual one, so a normal
 * fast join only ever shows something sensible — the salon-flavoured lines are
 * only reached when the POST is slow enough that a static screen would start
 * to feel stuck.
 *
 * Loops forever rather than holding on the last line: a stalled join then
 * still visibly moves. The failure case is covered elsewhere — a failed POST
 * navigates away with a toast, so this never spins indefinitely on an error.
 */
// DELIBERATELY TOOL-AGNOSTIC. An earlier draft had "Warming up the clippers…",
// which only makes sense for a barber — the category list spans Nails, Makeup,
// Skincare, Spa & Massage and Tattoos & Piercings, so anything naming a
// specific tool reads as "this app is for haircuts" to most customers. These
// stay on the queue and the seat, which every category shares.
const WAIT_MESSAGES = [
  'Finding your spot…',
  'Saving you a seat…',
  'Checking who’s ahead of you…',
  'Getting you in line…',
  'Almost there…',
];
/** Long enough to read a line, short enough that the screen never feels dead. */
const MESSAGE_MS = 2200;
/** Must match the duration class on the <p> below. */
const FADE_MS = 200;

/**
 * Transient "Finding your spot…" screen shown between the join form and the
 * position page. Navigated to immediately (navigation-is-feedback); the POST
 * resolves independently and sets `visit.pendingJoin`. A constructor effect
 * fires on mount AND on every change, so a result that lands before mount is
 * picked up immediately — which is impossible with a Subject but safe with a
 * signal.
 */
@Component({
  selector: 'app-joining-queue',
  template: `
    <!-- min-h-[70vh], not h-full or min-h-screen: the outlet's ancestors are
         block containers so h-full collapses to the 16rem min and centred near
         the top (the reported bug), while min-h-screen overflows a shell that
         already spends height on a top bar and bottom nav. Matches the
         in-shell centred-state pattern used by payment-callback. -->
    <div class="flex flex-col items-center justify-center min-h-[70vh] gap-4 p-6">
      <div class="w-16 h-16 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
      <!-- aria-live so the rotating copy is announced; the fade is opacity-only
           so the text never shifts position between messages. -->
      <p
        role="status"
        aria-live="polite"
        class="text-sm text-text-secondary text-center transition-opacity duration-200"
        [class.opacity-0]="!messageVisible()"
      >
        {{ message() }}
      </p>
    </div>
  `,
})
export class JoiningQueueComponent implements OnDestroy {
  private readonly _visit = inject(SalonVisitService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _toast = inject(ToastService);
  private readonly _document = inject(DOCUMENT);

  private readonly _messageIndex = signal(0);
  protected readonly messageVisible = signal(true);
  protected readonly message = computed(() => WAIT_MESSAGES[this._messageIndex()]);

  private _rotateTimer: ReturnType<typeof setInterval> | null = null;
  private _fadeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Honour a reduced-motion preference by not rotating at all — the plain
    // first line simply stays put, which is a complete screen on its own.
    const reduced = !!this._document.defaultView?.matchMedia('(prefers-reduced-motion: reduce)')
      .matches;
    if (!reduced) this._startRotating();

    effect(() => {
      const pending = this._visit.pendingJoin();
      if (!pending || pending.status === 'pending') return;

      if (pending.status === 'joined') {
        const { entryId, queueId, slug, shellPrefix } = pending;
        this._visit.pendingJoin.set(null);
        const segments = RoutePath.visitPosition(shellPrefix, slug, queueId, entryId);
        this._router.navigate(segments, { replaceUrl: true });
      } else {
        // failed — navigate back to salon landing
        const slug = this._route.snapshot.paramMap.get(RouteParam.SLUG) ?? '';
        const prefix = (this._route.snapshot.data['shellPrefix'] as string | undefined) ?? '';
        const base = RoutePath.visitSalon(prefix, slug);
        this._visit.pendingJoin.set(null);

        if (pending.reason === 'closed') {
          this._toast.info('Queue is not open right now.');
        } else if (pending.reason === 'party-too-large') {
          this._toast.error('Party size is too large.');
        } else {
          this._toast.error('Something went wrong. Please try again.');
        }
        this._router.navigate(base, { replaceUrl: true });
      }
    });
  }

  ngOnDestroy(): void {
    if (this._rotateTimer !== null) clearInterval(this._rotateTimer);
    if (this._fadeTimer !== null) clearTimeout(this._fadeTimer);
  }

  // Fade the current line out, swap it at the bottom of the dip, fade back in
  // — so the copy never hard-cuts mid-read. Wraps forever via % length.
  private _startRotating(): void {
    this._rotateTimer = setInterval(() => {
      this.messageVisible.set(false);
      this._fadeTimer = setTimeout(() => {
        this._messageIndex.update((i) => (i + 1) % WAIT_MESSAGES.length);
        this.messageVisible.set(true);
        this._fadeTimer = null;
      }, FADE_MS);
    }, MESSAGE_MS);
  }
}
