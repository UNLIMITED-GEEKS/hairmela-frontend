import { Component, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DOCUMENT } from '@angular/common';
import { RoutePath } from '../../core/routing/route-paths';
import { AppPlatformService } from '../../core/native/app-platform.service';

interface OnboardingSlide {
  readonly image: string;
  /**
   * CSS object-position for the photo. These are portrait/square shots and the
   * viewport is landscape on desktop, so object-cover keeps only a horizontal
   * band — on a 16:9 screen that is the middle 40% of mei_hd and 56% of
   * welc_hd. Faces sit near the top in both, so a default centre crop shows a
   * torso and cuts the head off. Each slide names where to anchor instead.
   */
  readonly focus?: string;
  readonly title: string;
  readonly body: string;
}

// How long each slide holds before advancing, and how long the track takes to
// glide to the next one.
const AUTOPLAY_MS = 4500;
const SLIDE_MS = 450;
// Half of one text cross-fade — the copy is swapped at the trough, so a full
// out-and-in costs 2x this. Deliberately SLOWER than the photo slide
// (SLIDE_MS): a quick blink reads as a glitch, while a long dissolve reads as
// intentional. The words therefore settle a little after the image does, which
// is the right order — the photo leads, the copy follows it in.
const TEXT_FADE_MS = 250;
// Fraction of the viewport a drag must cover to count as "next slide" rather
// than a twitch. A third is forgiving on a small screen without firing on an
// accidental brush.
const SWIPE_THRESHOLD = 0.3;

// Signed-out landing for app contexts (Capacitor APK, installed PWA, iOS
// standalone) — the marketing site is the wrong first screen once there is no
// browser chrome around it. Chosen by HomeShellComponent; web keeps
// LandingComponent untouched.
//
// Reaching this while signed in is already prevented by guestGuard on the
// route, so there is no auth handling here. It shows on EVERY launch while
// signed out — there is deliberately no "already seen it" flag, because this
// is also the only way into sign-in from a cold app.
//
// One slide per audience: the three groups the app serves want different
// things from it, and a single generic pitch spoke to none of them.
@Component({
  selector: 'app-app-home',
  templateUrl: './app-home.component.html',
  imports: [RouterLink],
})
export class AppHomeComponent implements OnDestroy {
  private readonly _document = inject(DOCUMENT);
  protected readonly platform = inject(AppPlatformService);

  protected readonly registerLink = RoutePath.register();
  protected readonly loginLink = RoutePath.login();
  protected readonly guestSearchLink = RoutePath.guestSearch();

  protected readonly slides: readonly OnboardingSlide[] = [
    {
      image: '/images/two_hd.webp',
      focus: '50% 65%',
      title: 'Join the line before you leave home.',
      body: 'See how busy the salon is, take your spot, and show up right on time.',
    },
    {
      image: '/images/welc_hd.webp',
      focus: '50% 22%',
      title: 'Run your shop from your phone.',
      body: 'Your queue, your bookings, your income, and your staff, all in one place.',
    },
    {
      image: '/images/mei_hd.webp',
      focus: '50% 18%',
      title: 'Every client, in order, all day.',
      body: 'Call the next client, track your day, and keep your regulars coming back.',
    },
  ];

  protected readonly index = signal(0);

  // The slide whose COPY is currently rendered. Trails index() by one fade so
  // the words can dip to transparent before they are replaced — swapping them
  // at full opacity is the instant jump this exists to avoid.
  protected readonly textIndex = signal(0);
  protected readonly textVisible = signal(true);
  private _textTimer: ReturnType<typeof setTimeout> | null = null;

  // Live finger offset in PERCENT of one slide width, so it composes with the
  // index translation below without needing the element's pixel width in the
  // template. Zero whenever a drag is not in progress.
  private readonly _dragPercent = signal(0);
  protected readonly dragging = signal(false);

  protected readonly trackTransform = computed(
    () => `translate3d(${-this.index() * 100 + this._dragPercent()}%, 0, 0)`,
  );

  // Suppressed mid-drag so the track tracks the finger 1:1; restored on release
  // so it glides to whichever slide won.
  protected readonly trackTransition = computed(() =>
    this.dragging() ? 'none' : `transform ${SLIDE_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)`,
  );

  protected readonly textFadeMs = TEXT_FADE_MS;

  private _timer: ReturnType<typeof setInterval> | null = null;
  private _pointerId: number | null = null;
  private _startX = 0;
  private _width = 1;

  constructor() {
    // Honour a reduced-motion preference by not auto-advancing at all: the
    // slides still work, they just wait to be swiped.
    const reduced = !!this._document.defaultView?.matchMedia('(prefers-reduced-motion: reduce)')
      .matches;
    if (!reduced) this._startAutoplay();

    // Cross-fade the card copy whenever the slide changes, from any source:
    // autoplay, a swipe, or a dot. Keyed off index() rather than being called
    // from each of those, so no path can forget to animate.
    effect(() => {
      const next = this.index();
      untracked(() => {
        if (next === this.textIndex()) return;
        if (reduced) {
          // No fade to run — swap outright rather than leaving the copy
          // stranded at opacity 0.
          this.textIndex.set(next);
          return;
        }
        if (this._textTimer !== null) clearTimeout(this._textTimer);
        this.textVisible.set(false);
        this._textTimer = setTimeout(() => {
          // Read index() again rather than closing over `next`: a fast second
          // swipe during the dip must land on the slide the user actually
          // ended on, not the one that started this fade.
          this.textIndex.set(untracked(() => this.index()));
          this.textVisible.set(true);
          this._textTimer = null;
        }, TEXT_FADE_MS);
      });
    });
  }

  ngOnDestroy(): void {
    this._stopAutoplay();
    if (this._textTimer !== null) clearTimeout(this._textTimer);
  }

  private _startAutoplay(): void {
    this._timer = setInterval(() => {
      // Wraps forever — the last slide leads back to the first.
      this.index.update((i) => (i + 1) % this.slides.length);
    }, AUTOPLAY_MS);
  }

  // Permanent, not a pause. Once someone starts driving the carousel, having it
  // resume and pull a slide away mid-read is worse than simply stopping.
  private _stopAutoplay(): void {
    if (this._timer === null) return;
    clearInterval(this._timer);
    this._timer = null;
  }

  protected goTo(i: number): void {
    this._stopAutoplay();
    this.index.set(i);
  }

  // ── Swipe ────────────────────────────────────────────────────────────────
  //
  // Pointer events rather than touch events: one code path covers finger,
  // trackpad and mouse, and setPointerCapture keeps the gesture alive when the
  // finger leaves the element mid-drag.

  protected onPointerDown(event: PointerEvent): void {
    // Ignore secondary buttons; a right-click drag should not move the track.
    if (event.button !== 0) return;
    this._stopAutoplay();
    this._pointerId = event.pointerId;
    this._startX = event.clientX;
    this._width = (event.currentTarget as HTMLElement).clientWidth || 1;
    this.dragging.set(true);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (this._pointerId !== event.pointerId || !this.dragging()) return;
    const delta = ((event.clientX - this._startX) / this._width) * 100;
    // Rubber-band at the two ends: the track still moves so the gesture feels
    // alive, but at a third of the distance to say "nothing over here".
    const atStart = this.index() === 0 && delta > 0;
    const atEnd = this.index() === this.slides.length - 1 && delta < 0;
    this._dragPercent.set(atStart || atEnd ? delta / 3 : delta);
  }

  protected onPointerUp(event: PointerEvent): void {
    if (this._pointerId !== event.pointerId) return;
    const moved = this._dragPercent();
    this._pointerId = null;
    this.dragging.set(false);
    this._dragPercent.set(0);

    if (Math.abs(moved) < SWIPE_THRESHOLD * 100) return; // snap back
    const next = this.index() + (moved < 0 ? 1 : -1);
    // Clamped, not wrapped: a swipe past the last slide should stop there.
    // Autoplay wraps; a deliberate gesture should not teleport.
    this.index.set(Math.min(Math.max(next, 0), this.slides.length - 1));
  }
}
