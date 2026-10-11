import { Pipe, PipeTransform } from '@angular/core';
import { currencySymbol } from '../../core/geo/currencies.data';

// Backend money values (Service.price, *RevenueDto.totalRevenue, etc.) are
// Postgres numeric columns serialized as strings (e.g. "150000.00") to avoid
// float precision loss — every template that interpolated one directly as
// `₦{{ value }}` rendered that raw decimal string verbatim: no thousands
// separator, and a trailing .00 even on whole amounts. This formats them the
// way tier-plans.ts's formatPlanPrice() already does for plan prices,
// extended to accept the string shape everything else actually has, and
// showing decimals only when the amount has cents.
//
// CURRENCY IS A PARAMETER, NOT BAKED IN. Salons choose their currency (see
// the create/settings forms), so a Ghanaian salon's prices must render GH₵,
// not ₦. Callers pass the salon's ISO code; omitting it falls back to NGN,
// which is both the home market and the backend's own default.
//
// Named currencyNgn for historical reasons — renaming it would touch every
// template for no behavioural gain. It has not been Naira-only since salon
// currency landed.
@Pipe({ name: 'currencyNgn' })
export class CurrencyNgnPipe implements PipeTransform {
  transform(value: string | number | null | undefined, code?: string | null, maximumFractionDigits = 2): string {
    const symbol = currencySymbol(code);
    if (value === null || value === undefined || value === '') return `${symbol}0`;
    const amount = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(amount)) return `${symbol}0`;
    // en-NG only affects separator style (1,500 vs 1 500), not the symbol —
    // which we supply ourselves so it always matches the salon's currency.
    return `${symbol}${amount.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits })}`;
  }
}
