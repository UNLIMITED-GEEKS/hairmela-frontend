import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { BillingService } from './billing.service';
import { IapOffer, IapService } from '../../../core/native/iap.service';
import { AppResumeService } from '../../../core/native/app-resume.service';
import { ToastService } from '../../../core/toast/toast.service';
import { OrgContextService } from '../../../core/salon-context/org-context.service';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonsStore } from '../../../core/salon-context/salons.store';
import { SILENT_ERRORS } from '../../../core/interceptors/error.interceptor';
import { EffectiveAccessDto } from '../../../api/models/effective-access-dto';
import { PurchasesPackage } from '@revenuecat/purchases-capacitor';

// Covers what the user sees between Apple's payment sheet closing and the plan
// being applied. The bug: the busy state was the card checkout's _acting flag,
// which is cleared whenever the app returns to the foreground — and Apple's
// sheet counts as leaving the app. So "Working…" vanished mid-purchase, then
// nothing showed until a late toast. Confirmation now has its own state that
// stays up until the backend reports the purchased plan, and the whole app's
// cached plan data is refreshed when it does.

const ORG_ID = 'org-1';
const SYNC_URL = `/v1/organizations/${ORG_ID}/subscription/apple/sync`;
const PRO_OFFER: IapOffer = { tier: 2, price: '₦6,900', pkg: {} as PurchasesPackage };

function access(over: Partial<EffectiveAccessDto> = {}): EffectiveAccessDto {
  return {
    billingOption: null,
    daysLeft: 10,
    endsAt: null,
    isTrialing: true,
    pendingTier: null,
    salonLimit: 1,
    staffLimit: 1,
    startsAt: null,
    status: 'TRIALING',
    tier: 3,
    trialEndsAt: null,
    ...over,
  };
}

const PRO_ACTIVE = access({ billingOption: 'APPLE_IAP', isTrialing: false, status: 'ACTIVE', tier: 2 });

describe('BillingService App Store purchase confirmation', () => {
  let service: BillingService;
  let http: HttpTestingController;
  let iap: { loadOffers: ReturnType<typeof vi.fn>; purchase: ReturnType<typeof vi.fn>; restore: ReturnType<typeof vi.fn> };
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };
  let resumed: ReturnType<typeof signal<number>>;
  let salonContext: { reloadMemberships: ReturnType<typeof vi.fn> };
  let orgContext: { refreshAccess: ReturnType<typeof vi.fn>; ownedOrg: ReturnType<typeof signal>; access: ReturnType<typeof signal> };
  let salonsStore: { refreshSilent: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.useFakeTimers();
    iap = {
      loadOffers: vi.fn().mockResolvedValue([PRO_OFFER]),
      purchase: vi.fn().mockResolvedValue(true),
      restore: vi.fn().mockResolvedValue(true),
    };
    toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
    resumed = signal(0);
    salonContext = { reloadMemberships: vi.fn() };
    orgContext = { refreshAccess: vi.fn(), ownedOrg: signal(null), access: signal(null) };
    salonsStore = { refreshSilent: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: IapService, useValue: iap },
        { provide: ToastService, useValue: toast },
        { provide: AppResumeService, useValue: { resumed } },
        { provide: SalonContextService, useValue: salonContext },
        { provide: OrgContextService, useValue: orgContext },
        { provide: SalonsStore, useValue: salonsStore },
      ],
    });
    service = TestBed.inject(BillingService);
    http = TestBed.inject(HttpTestingController);

    service.loadIapOffers(ORG_ID);
    await vi.advanceTimersByTimeAsync(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Answers the next pending sync call with `body`.
  function answerSync(body: EffectiveAccessDto): void {
    http.expectOne((r) => r.url.endsWith(SYNC_URL)).flush(body);
  }

  it('keeps showing progress across the app resume Apple’s sheet causes', async () => {
    let finishPurchase!: (ok: boolean) => void;
    iap.purchase.mockReturnValue(new Promise<boolean>((resolve) => (finishPurchase = resolve)));

    void service.purchaseIap(ORG_ID, 2);
    expect(service.iapConfirm()).toBe('purchasing');

    resumed.update((n) => n + 1);
    TestBed.tick();
    expect(service.iapConfirm()).toBe('purchasing');

    finishPurchase(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(service.iapConfirm()).toBe('confirming');
  });

  it('confirms once the backend reports the purchased plan, then refreshes app data', async () => {
    await service.purchaseIap(ORG_ID, 2);
    await vi.advanceTimersByTimeAsync(0);

    answerSync(access()); // webhook not applied yet
    expect(service.iapConfirm()).toBe('confirming');

    await vi.advanceTimersByTimeAsync(2_000);
    answerSync(PRO_ACTIVE);

    expect(service.iapConfirm()).toBe('idle');
    expect(toast.success).toHaveBeenCalledWith('Your Pro plan is active.');
    expect(salonContext.reloadMemberships).toHaveBeenCalled();
    expect(orgContext.refreshAccess).toHaveBeenCalled();
    expect(salonsStore.refreshSilent).toHaveBeenCalled();
  });

  it('checks silently and falls back to a plain read when the sync call fails', async () => {
    await service.purchaseIap(ORG_ID, 2);
    await vi.advanceTimersByTimeAsync(0);

    const sync = http.expectOne((r) => r.url.endsWith(SYNC_URL));
    expect(sync.request.context.get(SILENT_ERRORS)).toBe(true);
    sync.flush(null, { status: 502, statusText: 'Bad Gateway' });

    const read = http.expectOne((r) => r.method === 'GET' && r.url.endsWith(`/v1/organizations/${ORG_ID}/subscription/me`));
    expect(read.request.context.get(SILENT_ERRORS)).toBe(true);
    read.flush(PRO_ACTIVE);

    expect(service.iapConfirm()).toBe('idle');
  });

  it('turns to delayed when the checks run out, and Check again restarts them', async () => {
    await service.purchaseIap(ORG_ID, 2);
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
      http.match((r) => r.url.endsWith(SYNC_URL)).forEach((r) => r.flush(access()));
    }
    expect(service.iapConfirm()).toBe('delayed');

    service.checkIapNow();
    expect(service.iapConfirm()).toBe('confirming');
    await vi.advanceTimersByTimeAsync(0);
    answerSync(PRO_ACTIVE);
    expect(service.iapConfirm()).toBe('idle');
  });

  it('returns to idle without checking when the user cancels Apple’s sheet', async () => {
    iap.purchase.mockResolvedValue(false);

    await service.purchaseIap(ORG_ID, 2);
    await vi.advanceTimersByTimeAsync(0);

    expect(service.iapConfirm()).toBe('idle');
    http.expectNone((r) => r.url.endsWith(SYNC_URL));
  });

  it('says so when there is nothing to restore', async () => {
    iap.restore.mockResolvedValue(false);

    await service.restoreIap(ORG_ID);
    await vi.advanceTimersByTimeAsync(0);

    expect(service.iapConfirm()).toBe('idle');
    expect(toast.info).toHaveBeenCalledWith('No App Store subscription found to restore.');
    http.expectNone((r) => r.url.endsWith(SYNC_URL));
  });
});
