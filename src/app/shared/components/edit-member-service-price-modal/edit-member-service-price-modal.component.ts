import {
  Component,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { CurrencyNgnPipe } from '../../pipes/currency-ngn.pipe';
import { InlineSpinnerComponent } from '../inline-spinner/inline-spinner.component';
import { registerOverlayWhileOpen } from '../../../core/overlay/overlay-registry';
import { currencySymbol } from '../../../core/geo/currencies.data';

const PRICE_REGEX = /^\d{1,8}(?:\.\d{1,2})?$/;

@Component({
  selector: 'app-edit-member-service-price-modal',
  templateUrl: './edit-member-service-price-modal.component.html',
  imports: [ReactiveFormsModule, InlineSpinnerComponent],
})
export class EditMemberServicePriceModalComponent {
  readonly open = input.required<boolean>();
  readonly serviceName = input<string>('Service');
  readonly currentPrice = input<string>('0');
  readonly currencyCode = input<string | null>(null);
  readonly loading = input<boolean>(false);

  readonly closed = output<void>();
  readonly priceSubmitted = output<string>();

  protected readonly priceControl = new FormControl('', [
    Validators.required,
    Validators.pattern(PRICE_REGEX),
  ]);

  constructor() {
    registerOverlayWhileOpen(this.open, () => this.close());

    effect(() => {
      if (this.open()) {
        const initial = this.currentPrice() ?? '0';
        untracked(() => {
          this.priceControl.setValue(initial);
          this.priceControl.markAsUntouched();
        });
      }
    });
  }

  protected get currencySign(): string {
    return currencySymbol(this.currencyCode());
  }

  protected close(): void {
    if (this.loading()) return;
    this.closed.emit();
  }

  protected submit(): void {
    if (this.priceControl.invalid || this.loading()) {
      this.priceControl.markAsTouched();
      return;
    }
    const val = (this.priceControl.value ?? '').trim();
    if (!PRICE_REGEX.test(val)) return;
    this.priceSubmitted.emit(val);
  }
}

