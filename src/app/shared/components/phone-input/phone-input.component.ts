import { Component, effect, forwardRef, input, signal } from '@angular/core';
import {
  AbstractControl,
  ControlValueAccessor,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { CountryCode } from 'libphonenumber-js';
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRIES,
  normalizePhoneNumber,
  splitPhoneNumber,
} from '../../../core/phone/phone-number';

@Component({
  selector: 'app-phone-input',
  templateUrl: './phone-input.component.html',
  styleUrl: './phone-input.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => PhoneInputComponent),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => PhoneInputComponent),
      multi: true,
    },
  ],
})
export class PhoneInputComponent implements ControlValueAccessor, Validator {
  readonly inputId = input('phone');
  readonly autocomplete = input('tel');
  readonly fallbackCountry = input<CountryCode>(DEFAULT_PHONE_COUNTRY);
  readonly requireCountryForLegacyValue = input(false);

  protected readonly countries = PHONE_COUNTRIES;
  protected readonly country = signal<CountryCode | null>(DEFAULT_PHONE_COUNTRY);
  protected readonly nationalNumber = signal('');
  protected readonly disabled = signal(false);

  private _onChange: (value: string) => void = () => undefined;
  private _onTouched: () => void = () => undefined;
  private _onValidatorChange: () => void = () => undefined;
  private _writtenValue: string | null = null;

  constructor() {
    effect(() => {
      this.fallbackCountry();
      this.requireCountryForLegacyValue();
      this._applyWrittenValue();
    });
  }

  writeValue(value: string | null): void {
    this._writtenValue = value;
    this._applyWrittenValue();
  }

  private _applyWrittenValue(): void {
    const trimmed = this._writtenValue?.trim() ?? '';
    if (this.requireCountryForLegacyValue() && trimmed && !trimmed.startsWith('+')) {
      this.country.set(null);
      this.nationalNumber.set(trimmed);
      return;
    }

    const split = splitPhoneNumber(this._writtenValue, this.fallbackCountry());
    this.country.set(split.country);
    this.nationalNumber.set(split.nationalNumber);
  }

  registerOnChange(fn: (value: string) => void): void {
    this._onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this._onTouched = fn;
  }

  registerOnValidatorChange(fn: () => void): void {
    this._onValidatorChange = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }

  validate(control: AbstractControl): ValidationErrors | null {
    if (!control.value) return null;
    const country = this.country();
    return country && normalizePhoneNumber(this.nationalNumber(), country)
      ? null
      : { phone: true };
  }

  protected setCountry(value: string): void {
    this.country.set(value ? (value as CountryCode) : null);
    this._emitValue();
  }

  protected setNumber(value: string): void {
    const trimmed = value.trim();
    const international = trimmed.startsWith('+')
      ? normalizePhoneNumber(trimmed, this.country() ?? DEFAULT_PHONE_COUNTRY)
      : null;

    // Browser autofill commonly inserts the complete international value even
    // though the country selector already owns that prefix. Split it back into
    // its UI parts so users see only the national number in this input.
    if (international) {
      const split = splitPhoneNumber(international, this.country() ?? DEFAULT_PHONE_COUNTRY);
      this.country.set(split.country);
      this.nationalNumber.set(split.nationalNumber);
    } else {
      this.nationalNumber.set(value);
    }
    this._emitValue();
  }

  protected markTouched(): void {
    this._onTouched();
  }

  private _emitValue(): void {
    const raw = this.nationalNumber().trim();
    const country = this.country();
    const value = (country ? normalizePhoneNumber(raw, country) : null) ?? raw;
    this._onChange(value);
    this._onValidatorChange();
  }
}
