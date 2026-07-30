import { Pipe, PipeTransform } from '@angular/core';

// Backend money values (Service.price, *RevenueDto.totalRevenue, etc.) are
// Postgres numeric columns serialized as strings (e.g. "150000.00") to avoid
// float precision loss — every template that interpolated one directly as
// `₦{{ value }}` rendered that raw decimal string verbatim: no thousands
// separator, and a trailing .00 even on whole-naira amounts. This formats
// them the way tier-plans.ts's formatPlanPrice() already does for plan
// prices (₦150,000), extended to accept the string shape everything else
// actually has, and showing decimals only when the amount has cents.
@Pipe({ name: 'currencyNgn' })
export class CurrencyNgnPipe implements PipeTransform {
  transform(value: string | number | null | undefined): string {
    if (value === null || value === undefined || value === '') return '₦0';
    const amount = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(amount)) return '₦0';
    return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
}
