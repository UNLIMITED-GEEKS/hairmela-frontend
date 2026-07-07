import { Component, input, computed } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl } from '@angular/forms';
import { EMPTY, startWith, switchMap } from 'rxjs';

@Component({
  selector: 'app-field-error',
  templateUrl: './field-error.component.html',
})
export class FieldErrorComponent {
  readonly control = input<AbstractControl | null>(null);
  readonly messages = input<Record<string, string>>({});

  // control.touched/.errors are plain properties, not signals — control.events is the
  // only observable that emits on markAsTouched() (blur), not just statusChanges/valueChanges.
  private readonly _tick = toSignal(
    toObservable(this.control).pipe(
      switchMap((control) => (control ? control.events : EMPTY)),
      startWith(null),
    ),
  );

  protected readonly message = computed(() => {
    this._tick();
    const control = this.control();
    if (!control || !control.invalid || !control.touched) return null;

    const errors = control.errors;
    if (!errors) return null;

    const custom = this.messages();
    const key = Object.keys(errors)[0];
    if (!key) return null;

    if (custom[key]) return custom[key];
    return this._defaultMessage(key, errors[key]);
  });

  private _defaultMessage(key: string, error: unknown): string | null {
    switch (key) {
      case 'required':
        return 'This field is required.';
      case 'email':
        return 'Enter a valid email address.';
      case 'minlength':
        return `Must be at least ${(error as { requiredLength: number }).requiredLength} characters.`;
      case 'maxlength':
        return `Must be no more than ${(error as { requiredLength: number }).requiredLength} characters.`;
      case 'min':
        return `Must be at least ${(error as { min: number }).min}.`;
      case 'max':
        return `Must be no more than ${(error as { max: number }).max}.`;
      case 'pattern':
        return 'Invalid format.';
      default:
        return null;
    }
  }
}
