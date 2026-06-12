import {
  Directive,
  TemplateRef,
  ViewContainerRef,
  inject,
  input,
  effect,
} from '@angular/core';
import { SalonContextService } from '../../core/salon-context/salon-context.service';
import { SalonRole } from '../../core/salon-context/membership.types';

@Directive({
  selector: '[hasRole]',
})
export class HasRoleDirective {
  readonly hasRole = input.required<SalonRole[]>();

  private readonly _templateRef = inject(TemplateRef<unknown>);
  private readonly _viewContainer = inject(ViewContainerRef);
  private readonly _salonContext = inject(SalonContextService);

  private _hasView = false;

  constructor() {
    effect(() => {
      const membership = this._salonContext.membership();
      const allowed = this.hasRole();

      if (membership && allowed.includes(membership.role)) {
        if (!this._hasView) {
          this._viewContainer.createEmbeddedView(this._templateRef);
          this._hasView = true;
        }
      } else {
        this._viewContainer.clear();
        this._hasView = false;
      }
    });
  }
}
