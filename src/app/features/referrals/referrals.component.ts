import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../api/api-configuration';
import { referralsControllerGetStats } from '../../api/fn/referrals/referrals-controller-get-stats';
import { ReferralStatsDto } from '../../api/models/referral-stats-dto';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { InlineSpinnerComponent } from '../../shared/components/inline-spinner/inline-spinner.component';
import { ToastService } from '../../core/toast/toast.service';
import { copyToClipboard } from '../../core/clipboard/copy-to-clipboard';

/**
 * Shared access key for the referral stats endpoint.
 *
 * Deliberately in the bundle. The BACKEND is what actually enforces this (the
 * route 403s without it) — this copy only avoids firing a request that is
 * certain to fail, so a wrong key gives an instant answer instead of a round
 * trip. Anyone reading the bundle gains nothing the backend would not have
 * given them anyway.
 */
const ACCESS_KEY = 'pass1234';

@Component({
  selector: 'app-referrals',
  templateUrl: './referrals.component.html',
  imports: [ReactiveFormsModule, PageHeaderComponent, InlineSpinnerComponent, DatePipe],
})
export class ReferralsComponent {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _fb = inject(FormBuilder);
  private readonly _toast = inject(ToastService);

  protected readonly form = this._fb.group({
    key: ['', Validators.required],
  });

  protected readonly keyError = signal(false);
  protected readonly unlocked = signal(false);
  protected readonly loading = signal(false);
  protected readonly loadError = signal(false);
  protected readonly stats = signal<ReferralStatsDto[]>([]);

  /**
   * The referrer whose salon list is open in the modal, or null when closed.
   *
   * Holds the whole row rather than a code so the modal can title itself and
   * list the salons without looking the row up again.
   */
  protected readonly salonsModalFor = signal<ReferralStatsDto | null>(null);

  protected readonly totals = computed(() => {
    const rows = this.stats();
    return {
      referrers: rows.length,
      salons: rows.reduce((n, r) => n + r.salonsReferred, 0),
      orgs: rows.reduce((n, r) => n + r.orgsReferred, 0),
      paying: rows.reduce((n, r) => n + r.payingSubscriptions, 0),
    };
  });

  protected submitKey(): void {
    // Front-end check first: a wrong key never reaches the network.
    if (this.form.getRawValue().key?.trim() !== ACCESS_KEY) {
      this.keyError.set(true);
      return;
    }
    this.keyError.set(false);
    this.unlocked.set(true);
    this._load();
  }

  protected retry(): void {
    this._load();
  }

  /**
   * tierBreakdown as sorted entries — it's an open-ended map (tier names plus
   * TRIALING/EXPIRED/CANCELLED), so the template can't hardcode its keys.
   * Zero-count buckets are dropped; showing every possible key for every row
   * would bury the ones that matter.
   */
  protected tierEntries(row: ReferralStatsDto): { tier: string; count: number }[] {
    return Object.entries(row.tierBreakdown ?? {})
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([tier, count]) => ({ tier, count }));
  }

  /** Referral codes are shared verbatim, so copying beats retyping. */
  protected copyCode(code: string): void {
    copyToClipboard(this._toast, code, 'Referral code');
  }

  protected openSalons(row: ReferralStatsDto): void {
    this.salonsModalFor.set(row);
  }

  protected closeSalons(): void {
    this.salonsModalFor.set(null);
  }

  private _load(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.loadError.set(false);

    referralsControllerGetStats(this._http, this._apiConfig.rootUrl, { key: ACCESS_KEY })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          this.stats.set(res.body);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.loadError.set(true);
        },
      });
  }
}
