import {
  CountryCode,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from 'libphonenumber-js';

export const DEFAULT_PHONE_COUNTRY: CountryCode = 'NG';

const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });

export const PHONE_COUNTRIES = getCountries()
  .map((code) => ({
    code,
    name: displayNames.of(code) ?? code,
    callingCode: `+${getCountryCallingCode(code)}`,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

export interface PhoneInputValue {
  country: CountryCode;
  nationalNumber: string;
}

export function splitPhoneNumber(
  value: string | null | undefined,
  fallbackCountry: CountryCode = DEFAULT_PHONE_COUNTRY,
): PhoneInputValue {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return { country: fallbackCountry, nationalNumber: '' };

  const parsed = parsePhoneNumberFromString(trimmed, fallbackCountry);
  if (!parsed) return { country: fallbackCountry, nationalNumber: trimmed };

  return {
    country: parsed.country ?? fallbackCountry,
    nationalNumber: parsed.formatNational(),
  };
}

export function normalizePhoneNumber(
  nationalNumber: string | null | undefined,
  country: CountryCode = DEFAULT_PHONE_COUNTRY,
): string | null {
  const trimmed = nationalNumber?.trim() ?? '';
  if (!trimmed) return null;

  const parsed = parsePhoneNumberFromString(trimmed, country);
  return parsed?.isValid() ? parsed.number : null;
}
