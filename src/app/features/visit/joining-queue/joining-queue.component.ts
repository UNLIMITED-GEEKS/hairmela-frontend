import { Component, inject, effect } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { SalonVisitService } from '../salon-visit.service';
import { ToastService } from '../../../core/toast/toast.service';

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
    <div class="flex flex-col items-center justify-center h-full min-h-64 gap-4 p-6">
      <div class="w-16 h-16 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
      <p class="text-sm text-gray-500">Finding your spot…</p>
    </div>
  `,
})
export class JoiningQueueComponent {
  private readonly _visit = inject(SalonVisitService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _toast = inject(ToastService);

  constructor() {
    effect(() => {
      const pending = this._visit.pendingJoin();
      if (!pending || pending.status === 'pending') return;

      if (pending.status === 'joined') {
        const { entryId, queueId, slug, shellPrefix } = pending;
        this._visit.pendingJoin.set(null);
        const tail = ['q', queueId, 'e', entryId, 'position'];
        const segments = shellPrefix ? [shellPrefix, 's', slug, ...tail] : ['s', slug, ...tail];
        this._router.navigate(segments, { replaceUrl: true });
      } else {
        // failed — navigate back to salon landing
        const slug = this._route.snapshot.paramMap.get('slug') ?? '';
        const prefix = (this._route.snapshot.data['shellPrefix'] as string | undefined) ?? '';
        const base = prefix ? [prefix, 's', slug] : ['s', slug];
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
}
