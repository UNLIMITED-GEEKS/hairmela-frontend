import {
  Directive,
  TemplateRef,
  ViewContainerRef,
  inject,
  input,
  effect,
  EmbeddedViewRef,
} from '@angular/core';
import { SalonContextService } from '../../core/salon-context/salon-context.service';
import { SalonRole } from '../../core/salon-context/membership.types';

type TierMode = 'lock' | 'hide';

const STAFF_AND_ABOVE: SalonRole[] = [SalonRole.OWNER, SalonRole.ADMIN, SalonRole.STAFF];

@Directive({
  selector: '[requiresTier]',
})
export class RequiresTierDirective {
  readonly requiresTier = input.required<number>();
  readonly requiresTierMode = input<TierMode>('lock');

  private readonly _templateRef = inject(TemplateRef<unknown>);
  private readonly _viewContainer = inject(ViewContainerRef);
  private readonly _salonContext = inject(SalonContextService);

  private _viewRef: EmbeddedViewRef<unknown> | null = null;

  constructor() {
    effect(() => {
      const membership = this._salonContext.membership();
      const requiredTier = this.requiresTier();
      const mode = this.requiresTierMode();
      const currentTier = membership?.tier ?? 0;
      const allowed = currentTier >= requiredTier;

      // Customers never see tier-locked controls — hide entirely
      const isStaffOrAbove = membership
        ? STAFF_AND_ABOVE.includes(membership.role)
        : false;

      if (mode === 'hide' || !isStaffOrAbove) {
        if (allowed && isStaffOrAbove) {
          if (!this._viewRef) {
            this._viewRef = this._viewContainer.createEmbeddedView(this._templateRef);
          }
        } else {
          this._viewContainer.clear();
          this._viewRef = null;
        }
      } else {
        // lock mode for staff/admin/owner: render but disable with upgrade nudge
        if (!this._viewRef) {
          this._viewRef = this._viewContainer.createEmbeddedView(this._templateRef);
        }

        const rootEl = this._viewRef.rootNodes[0] as HTMLElement | undefined;
        if (rootEl) {
          if (!allowed) {
            rootEl.setAttribute('disabled', 'true');
            rootEl.setAttribute('aria-disabled', 'true');
            rootEl.setAttribute('title', 'Upgrade your plan to enable this feature');
            rootEl.classList.add('tier-locked');
          } else {
            rootEl.removeAttribute('disabled');
            rootEl.removeAttribute('aria-disabled');
            rootEl.removeAttribute('title');
            rootEl.classList.remove('tier-locked');
          }
        }
      }
    });
  }
}
