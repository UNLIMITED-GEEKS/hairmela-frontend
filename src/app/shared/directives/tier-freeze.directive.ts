import {
  Directive,
  ElementRef,
  inject,
  input,
  effect,
} from '@angular/core';

@Directive({
  selector: '[tierFreeze]',
})
export class TierFreezeDirective {
  readonly tierFreeze = input.required<boolean>();

  private readonly _el = inject(ElementRef<HTMLElement>);

  constructor() {
    effect(() => {
      const frozen = this.tierFreeze();
      const el: HTMLElement = this._el.nativeElement;

      if (frozen) {
        el.setAttribute('aria-disabled', 'true');
        el.setAttribute('title', 'This salon is frozen — upgrade to edit');
        el.classList.add('salon-frozen');

        Array.from(el.querySelectorAll('input, button, select, textarea')).forEach((ctrl) => {
          (ctrl as HTMLElement).setAttribute('disabled', 'true');
        });
      } else {
        el.removeAttribute('aria-disabled');
        el.removeAttribute('title');
        el.classList.remove('salon-frozen');

        Array.from(el.querySelectorAll('[disabled]')).forEach((ctrl) => {
          (ctrl as HTMLElement).removeAttribute('disabled');
        });
      }
    });
  }
}
