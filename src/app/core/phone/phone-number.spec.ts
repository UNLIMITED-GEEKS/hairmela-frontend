import { describe, expect, it } from 'vitest';
import { normalizePhoneNumber, splitPhoneNumber } from './phone-number';

describe('phone number helpers', () => {
  it('normalizes a Nigerian local number to E.164', () => {
    expect(normalizePhoneNumber('0803 123 4567', 'NG')).toBe('+2348031234567');
  });

  it('preserves and parses an international number for editing', () => {
    expect(normalizePhoneNumber('+1 415 555 2671', 'NG')).toBe('+14155552671');
    expect(splitPhoneNumber('+14155552671')).toEqual({
      country: 'US',
      nationalNumber: '(415) 555-2671',
    });
  });

  it('uses the supplied country for a legacy local salon number', () => {
    expect(normalizePhoneNumber('024 123 4567', 'GH')).toBe('+233241234567');
  });

  it('rejects incomplete numbers and permits an empty optional value', () => {
    expect(normalizePhoneNumber('0803', 'NG')).toBeNull();
    expect(normalizePhoneNumber('', 'NG')).toBeNull();
  });
});
