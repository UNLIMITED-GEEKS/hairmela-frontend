import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { DestroyRef, inject, Injectable, PLATFORM_ID } from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';

interface PendingRestore {
  readonly navigationId: number;
  readonly top: number;
  readonly fragment: string | null;
}

const MAX_SAVED_NAVIGATIONS = 200;

/**
 * Restores page-level vertical scroll for HairMela's inner-scroll shells.
 *
 * Auth and guest pages trap scrolling inside their shell `<main>`, which
 * Angular's ViewportScroller cannot see. Public pages keep using Angular's
 * built-in window restoration. This service records the active inner target
 * against Angular's history navigation id and restores it only for popstate
 * (Back/Forward). Normal forward navigation starts at 0.
 */
@Injectable({ providedIn: 'root' })
export class RouteScrollRestorationService {
  private readonly _router = inject(Router);
  private readonly _document = inject(DOCUMENT);
  private readonly _isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _positions = new Map<number, number>();
  private _target: HTMLElement | null = null;
  private _currentNavigationId: number | null = null;
  private _restoreFromNavigationId: number | null = null;
  private _pending: PendingRestore | null = null;
  private _restoreFrame: number | null = null;
  private _observedTarget: HTMLElement | null = null;
  private _mutationObserver: MutationObserver | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  private readonly _onContentLoad = () => this._scheduleRestore();

  constructor() {
    if (!this._isBrowser) return;

    this._router.events
      .pipe(
        filter((event) => event instanceof NavigationStart || event instanceof NavigationEnd),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((event) => {
        if (event instanceof NavigationStart) this._onNavigationStart(event);
        else this._onNavigationEnd(event);
      });

    // If the visitor starts interacting before delayed content is tall enough
    // to restore, their input wins; a late jump would be worse than no restore.
    const cancelPending = () => this._cancelPending();
    this._document.addEventListener('pointerdown', cancelPending, { passive: true });
    this._document.addEventListener('touchstart', cancelPending, { passive: true });
    this._document.addEventListener('wheel', cancelPending, { passive: true });
    this._destroyRef.onDestroy(() => {
      this._document.removeEventListener('pointerdown', cancelPending);
      this._document.removeEventListener('touchstart', cancelPending);
      this._document.removeEventListener('wheel', cancelPending);
      this._cancelPending();
    });
  }

  /** Register the shell's real page-level scroll owner. */
  register(target: HTMLElement): void {
    if (!this._isBrowser) return;
    this._target = target;
    this._applyPending();
  }

  /** Unregister only the target owned by the shell being destroyed. */
  unregister(target: HTMLElement): void {
    if (this._target !== target) return;
    this._stopWatching();
    this._target = null;
  }

  private _onNavigationStart(event: NavigationStart): void {
    this._cancelPending();
    if (this._currentNavigationId !== null && this._target) {
      this._remember(this._currentNavigationId, this._readTop(this._target));
    }

    this._restoreFromNavigationId =
      event.navigationTrigger === 'popstate' ? (event.restoredState?.navigationId ?? null) : null;
  }

  private _onNavigationEnd(event: NavigationEnd): void {
    const restoredId = this._restoreFromNavigationId;
    this._currentNavigationId = event.id;
    this._restoreFromNavigationId = null;

    this._pending = {
      navigationId: event.id,
      top: restoredId === null ? 0 : (this._positions.get(restoredId) ?? 0),
      fragment:
        restoredId === null ? this._router.parseUrl(event.urlAfterRedirects).fragment : null,
    };
    this._applyPending();
  }

  private _applyPending(): void {
    const pending = this._pending;
    const target = this._target;
    if (!pending || !target || pending.navigationId !== this._currentNavigationId) return;

    this._watchForReadiness(target);
    this._scheduleRestore();
  }

  private _scheduleRestore(): void {
    if (!this._pending || !this._target) return;
    this._cancelRestoreFrame();
    this._restoreFrame = requestAnimationFrame(() => {
      this._restoreFrame = null;
      this._tryRestore();
    });
  }

  private _tryRestore(): void {
    const pending = this._pending;
    const target = this._target;
    if (!pending || !target || pending.navigationId !== this._currentNavigationId) return;

    if (pending.fragment) {
      const anchor = this._document.getElementById(pending.fragment);
      if (anchor) {
        anchor.scrollIntoView();
        this._completeRestore();
      }
      return;
    }

    // An async page may initially contain only a short skeleton. Leave the
    // restore pending until real content makes the requested offset possible;
    // the observers below call this method again on actual layout changes.
    if (pending.top > this._maxTop(target)) return;

    this._writeTop(target, pending.top);
    this._completeRestore();
  }

  private _watchForReadiness(target: HTMLElement): void {
    if (this._observedTarget === target) return;
    this._stopWatching();
    this._observedTarget = target;

    // Child changes cover skeleton -> results and lazy route content. Watching
    // the stable direct children with ResizeObserver also catches image/font
    // layout shifts that do not mutate the DOM tree.
    this._mutationObserver = new MutationObserver(() => {
      this._observeLayoutChildren(target);
      this._scheduleRestore();
    });
    this._mutationObserver.observe(target, { childList: true, subtree: true });

    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this._scheduleRestore());
      this._observeLayoutChildren(target);
    }
    target.addEventListener('load', this._onContentLoad, true);
  }

  private _observeLayoutChildren(target: HTMLElement): void {
    if (!this._resizeObserver) return;
    this._resizeObserver.observe(target);
    for (const child of Array.from(target.children)) {
      this._resizeObserver.observe(child);
    }
  }

  private _completeRestore(): void {
    this._pending = null;
    this._stopWatching();
  }

  private _stopWatching(): void {
    this._cancelRestoreFrame();
    this._mutationObserver?.disconnect();
    this._resizeObserver?.disconnect();
    this._mutationObserver = null;
    this._resizeObserver = null;
    if (this._observedTarget) {
      this._observedTarget.removeEventListener('load', this._onContentLoad, true);
      this._observedTarget = null;
    }
  }

  private _remember(navigationId: number, top: number): void {
    this._positions.set(navigationId, top);
    if (this._positions.size <= MAX_SAVED_NAVIGATIONS) return;
    const oldest = this._positions.keys().next().value as number | undefined;
    if (oldest !== undefined) this._positions.delete(oldest);
  }

  private _readTop(target: HTMLElement): number {
    return target.scrollTop;
  }

  private _writeTop(target: HTMLElement, top: number): void {
    target.scrollTop = top;
  }

  private _maxTop(target: HTMLElement): number {
    return Math.max(0, target.scrollHeight - target.clientHeight);
  }

  private _cancelPending(): void {
    this._pending = null;
    this._stopWatching();
  }

  private _cancelRestoreFrame(): void {
    if (this._restoreFrame === null) return;
    cancelAnimationFrame(this._restoreFrame);
    this._restoreFrame = null;
  }
}
