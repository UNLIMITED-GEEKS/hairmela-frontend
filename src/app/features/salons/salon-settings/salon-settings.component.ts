import { Component, DestroyRef, inject, signal, computed, OnInit, effect, viewChild, ElementRef, Injector, afterNextRender } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import {
  AbstractControl,
  AbstractControlOptions,
  FormBuilder,
  FormArray,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { SalonSettingsService } from './salon-settings.service';
import { SalonOverviewService } from '../salon-overview/salon-overview.service';
import { SalonService } from '../salon.service';
import { SalonsStore } from '../../../core/salon-context/salons.store';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { ToastService } from '../../../core/toast/toast.service';
import { RenameDialogService } from '../../../shared/components/rename-dialog/rename-dialog.service';
import { BranchPickerService } from '../../visit/branch-picker/branch-picker.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { FrozenBannerComponent } from '../../../shared/components/frozen-banner/frozen-banner.component';
import { TierFreezeDirective } from '../../../shared/directives/tier-freeze.directive';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { InlineSpinnerComponent } from '../../../shared/components/inline-spinner/inline-spinner.component';
import { TimePickerComponent } from '../../../shared/components/time-picker/time-picker.component';
import { RouteParam } from '../../../core/routing/route-paths';
import { endAfterStart } from '../../../core/utils/time-range.validator';
import { ErrorCodes } from '../../../core/errors/error-codes';
import { COUNTRIES } from '../../../core/geo/countries-states.data';
import { CURRENCIES } from '../../../core/geo/currencies.data';
import { UpdateSalonDto } from '../../../api/models/update-salon-dto';
import { scrollToFirstInvalidControl } from '../../../core/utils/scroll-to-first-invalid';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIMEZONES = [
  'Africa/Lagos',
  'Africa/Nairobi',
  'Africa/Accra',
  'Africa/Johannesburg',
  'Africa/Cairo',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Kolkata',
];

/**
 * A salon charging a booking fee must say where the money goes.
 *
 * Cross-field, so it lives on the group: bank mode needs an account name,
 * link mode needs a link. The backend enforces this too
 * (PAYMENT_DETAILS_REQUIRED) — this exists so the owner is told at the point
 * of editing rather than having every customer's join fail later.
 *
 * Returns null whenever the fee is off, so a salon that isn't charging can
 * leave the whole payment section blank.
 */
function paymentDetailsRequiredWhenFeeEnforced(group: AbstractControl): ValidationErrors | null {
  if (!group.get('enforceBookingFee')?.value) return null;

  const errors: ValidationErrors = {};

  // Account name is needed either way — whoever is paying has to know whose
  // account it is, whether they transfer manually or follow a payment link.
  if (!group.get('accountName')?.value?.trim()) errors['paymentDetailsRequired'] = true;
  if (group.get('paymentType')?.value === 'link' && !group.get('paymentLink')?.value?.trim()) {
    errors['paymentLinkRequired'] = true;
  }

  // Both fee figures are required, not alternatives: percent is used normally,
  // and the fixed amount is what the backend falls back to when every booked
  // service has dynamic pricing and no percentage can be worked out.
  const percent = group.get('bookingFeePercent')?.value;
  const fixed = group.get('bookingFeeFixed')?.value;
  if (percent === null || percent === '' || Number(percent) <= 0) errors['feePercentRequired'] = true;
  if (fixed === null || fixed === '' || Number(fixed) <= 0) errors['feeFixedRequired'] = true;

  return Object.keys(errors).length ? errors : null;
}

@Component({
  selector: 'app-salon-settings',
  templateUrl: './salon-settings.component.html',
  imports: [
    ReactiveFormsModule,
    SkeletonComponent,
    FrozenBannerComponent,
    TierFreezeDirective,
    FieldErrorComponent,
    PageHeaderComponent,
    InlineSpinnerComponent,
    TimePickerComponent,
  ],
})
export class SalonSettingsComponent implements OnInit {
  // The <form> element, so a blocked submit can scroll to the first
  // invalid field — see scrollToFirstInvalidControl.
  private readonly _formEl = viewChild<ElementRef<HTMLElement>>('formEl');
  private readonly _scrollInjector = inject(Injector);

  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _fb = inject(FormBuilder);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _settings = inject(SalonSettingsService);
  private readonly _overview = inject(SalonOverviewService);
  private readonly _salonService = inject(SalonService);
  private readonly _salonsStore = inject(SalonsStore);
  private readonly _renameDialog = inject(RenameDialogService);
  private readonly _branchPicker = inject(BranchPickerService);
  protected readonly salonContext = inject(SalonContextService);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _toast = inject(ToastService);

  protected readonly loading = signal(true);
  protected readonly days = DAYS;
  protected readonly timezones = TIMEZONES;

  // Other salons this user owns/admins that this one could become a branch
  // of — excludes itself and anything that's already a branch (a branch
  // can't itself have branches, matching the backend's flat one-level model;
  // the backend is still the source of truth, this is just avoiding an
  // option that's guaranteed to fail with ALREADY_A_BRANCH/BRANCH_DIFFERENT_ORG).
  protected readonly eligibleParentSalons = computed(() =>
    this._salonsStore
      .salons()
      .map((s) => s.salon)
      .filter((s) => s.id !== this._salonId && !s.parentId),
  );

  protected readonly isBranch = computed(() => {
    const s = this._overview.salon() ?? this._settings.salon();
    return !!s?.parentId;
  });

  protected readonly selectedParentId = signal<string | null>(null);
  protected readonly markingAsBranch = signal(false);
  protected readonly unbranching = signal(false);

  // Dropdowns, not free text: salon search matches on these strings, and typed
  // values produced "Lagos" / "lagos state" / "Lagos State" for one place.
  protected readonly countries = COUNTRIES;
  protected readonly statesForCountry = signal<readonly string[]>([]);
  // Visible and editable, pre-filled from country — see create-salon for why
  // deriving it silently was wrong.
  protected readonly currencies = CURRENCIES;

  protected readonly form = this._fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    phone: ['', Validators.required],
    about: ['', Validators.maxLength(1000)],
    timezone: ['Africa/Lagos', Validators.required],
    currency: ['NGN', Validators.required],
    // Address is editable here because it was previously fixed at creation —
    // a salon that moved, or was created with a typo, had no way to correct it.
    address: this._fb.group({
      country: ['', Validators.required],
      state: ['', Validators.required],
      city: ['', Validators.required],
      street: ['', Validators.required],
    }),
    defaultSlotDuration: [30, [Validators.required, Validators.min(5), Validators.max(240)]],
    allowWalkIns: [true],
    showPrice: [false],
    maxPartySize: [5, [Validators.required, Validators.min(1), Validators.max(20)]],
    noShowWindow: [10, [Validators.required, Validators.min(1)]],
    // ── Booking fee ────────────────────────────────────────────────────────
    // Off by default. When on, customers are quoted a fee and must upload a
    // payment receipt before joining or booking. HairMela never handles the
    // money — it goes straight to the salon, which is why paymentDetails
    // below is required before this can be switched on.
    enforceBookingFee: [false],
    bookingFeePercent: [0, [Validators.min(0), Validators.max(100)]],
    bookingFeeFixed: [0, [Validators.min(0)]],
    // Service-total threshold above which the fee stops being a percentage and
    // becomes a flat amount equal to this number.
    //
    //   total <= threshold  -> pay bookingFeePercent% of the total
    //   total >  threshold  -> pay exactly bookingFeeThreshold
    //
    // A percentage of an expensive booking becomes an unreasonable deposit
    // (10% of N200,000 is N20,000), so the salon caps what it asks for.
    //
    // This is DISCONTINUOUS at the threshold by design: with 10% and a
    // N10,000 threshold, N9,999 of service pays N1,000 while N10,001 pays
    // N10,000 — a 10x jump for N2 more, and very nearly the whole job. The
    // hint in the template says so, because a salon picking this number
    // casually will surprise its own customers.
    //
    // 0 disables it; the percentage then applies at every total. Not part of
    // the required-fields validator for that reason.
    bookingFeeThreshold: [0, [Validators.min(0)]],
    // type drives which of the two groups below is required; both are kept in
    // the form so switching back and forth doesn't lose what was typed.
    paymentType: ['bank' as 'bank' | 'link'],
    bankName: [''],
    accountName: [''],
    accountNumber: [''],
    paymentLink: [''],
    paymentDescription: ['', Validators.maxLength(200)],
    operatingHours: this._fb.array(
      DAYS.map((_, i) =>
        this._fb.group(
          {
            enabled: [false],
            dayOfWeek: [i],
            startTime: ['09:00'],
            endTime: ['18:00'],
          },
          { validators: endAfterStart } as AbstractControlOptions,
        ),
      ),
    ),
  }, { validators: paymentDetailsRequiredWhenFeeEnforced } as AbstractControlOptions);

  /**
   * A worked example of the threshold's step, shown to the OWNER while they
   * choose the number.
   *
   * This is not the customer's fee — that is always quoted by the backend
   * (see BookingFeeService: never recompute an actual fee client-side). This
   * only illustrates the salon's own configuration, using the values in this
   * form, so the discontinuity is visible before it surprises a customer.
   *
   * Null when the threshold is off, or when the numbers can't produce a
   * meaningful illustration.
   */
  protected get feeThresholdExample(): {
    below: string;
    belowFee: string;
    above: string;
  } | null {
    const v = this.form.getRawValue();
    const threshold = Number(v.bookingFeeThreshold ?? 0);
    const percent = Number(v.bookingFeePercent ?? 0);
    if (threshold <= 0 || percent <= 0) return null;

    const currency = v.currency ?? '';
    const fmt = (n: number) => `${currency} ${Math.round(n).toLocaleString()}`;
    return {
      below: fmt(threshold),
      belowFee: fmt((threshold * percent) / 100),
      above: fmt(threshold + 1),
    };
  }

  protected readonly paymentTypes = [
    { value: 'bank' as const, label: 'Bank transfer' },
    { value: 'link' as const, label: 'Payment link' },
  ];

  protected get hoursArray(): FormArray {
    return this.form.get('operatingHours') as FormArray;
  }

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  constructor() {
    effect(() => {
      const s = this._overview.salon() ?? this._settings.salon();
      if (!s) return;
      const settings = s.settings as Record<string, unknown>;
      this.form.patchValue({
        name: s.name,
        phone: s.phone ?? '',
        about: s.about ?? '',
        timezone: s.timezone,
        defaultSlotDuration: s.defaultSlotDuration,
        allowWalkIns: (settings['allowWalkIns'] as boolean) ?? true,
        showPrice: (settings['showPrice'] as boolean) ?? false,
        maxPartySize: (settings['maxPartySize'] as number) ?? 5,
        noShowWindow: (settings['noShowWindow'] as number) ?? 10,
        enforceBookingFee: (settings['enforceBookingFee'] as boolean) ?? false,
        bookingFeePercent: (settings['bookingFeePercent'] as number) ?? 0,
        bookingFeeFixed: (settings['bookingFeeFixed'] as number) ?? 0,
        bookingFeeThreshold: (settings['bookingFeeThreshold'] as number) ?? 0,
        // null when the salon has never configured where to be paid.
        paymentType: s.paymentDetails?.type ?? 'bank',
        bankName: s.paymentDetails?.bankName ?? '',
        accountName: s.paymentDetails?.accountName ?? '',
        accountNumber: s.paymentDetails?.accountNumber ?? '',
        paymentLink: s.paymentDetails?.paymentLink ?? '',
        paymentDescription: s.paymentDetails?.description ?? '',
        currency: s.currency ?? 'NGN',
        address: {
          country: s.address?.country ?? '',
          state: s.address?.state ?? '',
          city: s.address?.city ?? '',
          street: s.address?.street ?? '',
        },
      // emitEvent: false is LOAD-BEARING. Without it, patching address.country
      // fires the valueChanges listener below, which treats a programmatic
      // patch as a user edit — overwriting the saved currency with the
      // country's default (a salon saved as UGX reloaded as NGN) and clearing
      // the saved state. Only a real user change should reset those.
      }, { emitEvent: false });
      // Prime the state dropdown from the saved country, otherwise the stored
      // state has no matching <option> and the select renders blank. Does NOT
      // touch currency — patchValue above already set the saved one.
      this._syncStates(s.address?.country ?? '', false);
      // Locked while this salon is a branch — the backend forces a branch's
      // name to match its root and blocks renaming until unbranched (see
      // unbranch() below, which is the only path back to an editable name).
      if (s.parentId) this.form.get('name')?.disable();
      else this.form.get('name')?.enable();
      const existingHours = s.operatingHours as Array<{
        dayOfWeek: number;
        startTime: string;
        endTime: string;
      }>;
      existingHours.forEach((h) => {
        this.hoursArray
          .at(h.dayOfWeek)
          .patchValue({ enabled: true, startTime: h.startTime, endTime: h.endTime });
      });
      this.loading.set(false);
    });
  }

  // prefillCurrency=false when priming from SAVED data: the owner may have
  // deliberately chosen a currency other than their country's default, and
  // overwriting it on load would silently discard that choice.
  private _syncStates(countryName: string, prefillCurrency = true): void {
    const match = COUNTRIES.find((c) => c.name === countryName);
    this.statesForCountry.set(match?.states ?? []);
    if (prefillCurrency && match?.currency) {
      this.form.get('currency')?.setValue(match.currency);
    }
  }

  ngOnInit(): void {
    // Keep states in sync with the chosen country, and CLEAR a stale state on
    // change — otherwise switching Nigeria -> Ghana leaves "Lagos" selected and
    // saves an address that cannot exist.
    this.form
      .get('address.country')
      ?.valueChanges.pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((name) => {
        this._syncStates(String(name ?? ''));
        this.form.get('address.state')?.setValue('');
      });

    const userId = this._currentUser.user()?.id ?? '';
    this._overview.load(this._salonId, userId);
    // Fallback: load directly in case the overview isn't already populated
    if (!this._overview.salon()) {
      this._settings.load(this._salonId);
    }
    // Source for eligibleParentSalons() — idempotent, no-ops if already loaded.
    this._salonsStore.load();
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      // Deferred: markAllAsTouched only renders the error messages on the next
      // change detection pass, and those messages shift layout — scrolling
      // before they exist lands at the wrong offset.
      afterNextRender(
        () => scrollToFirstInvalidControl(this._formEl()?.nativeElement),
        { injector: this._scrollInjector },
      );
      return;
    }

    // getRawValue(), not .value — .value excludes disabled controls (the
    // locked `name` field while this salon is a branch), which would
    // otherwise submit as undefined and wipe the name server-side.
    const v = this.form.getRawValue();
    type HourRow = {
      enabled: boolean | null;
      dayOfWeek: number | null;
      startTime: string | null;
      endTime: string | null;
    };
    const enabledHours = ((v.operatingHours ?? []) as HourRow[])
      .filter((h) => !!h.enabled)
      .map((h) => ({
        dayOfWeek: h.dayOfWeek ?? 0,
        startTime: h.startTime ?? '09:00',
        endTime: h.endTime ?? '18:00',
      }));

    this._settings.update(
      this._salonId,
      {
        name: v.name!,
        phone: v.phone!,
        about: v.about || undefined,
        timezone: v.timezone!,
        defaultSlotDuration: v.defaultSlotDuration!,
        operatingHours: enabledHours,
        address: {
          country: v.address!.country!,
          state: v.address!.state!,
          city: v.address!.city!,
          street: v.address!.street!,
        },
        currency: v.currency as UpdateSalonDto['currency'],
        paymentDetails: this._paymentDetailsPayload(),
      },
      {
        allowWalkIns: v.allowWalkIns!,
        showPrice: v.showPrice!,
        maxPartySize: v.maxPartySize!,
        noShowWindow: v.noShowWindow!,
        enforceBookingFee: v.enforceBookingFee!,
        bookingFeePercent: v.bookingFeePercent ?? 0,
        bookingFeeFixed: v.bookingFeeFixed ?? 0,
        bookingFeeThreshold: v.bookingFeeThreshold ?? 0,
      },
    );
    // Optimistic: the UI already reflects the change, so tell the user now
    // rather than waiting on the network round-trip. If the save actually
    // fails, the service's revert path shows its own error toast.
    this._toast.success('Settings saved');
  }

  /**
   * Only the fields for the chosen type, omitting blanks.
   *
   * undefined (not an empty object) when nothing is filled in, so a salon that
   * has never configured payment isn't sent a hollow record — the API treats
   * absent as "unconfigured", which is what null paymentDetails means to
   * customers reading the public salon page.
   */
  private _paymentDetailsPayload(): UpdateSalonDto['paymentDetails'] {
    const v = this.form.getRawValue();
    const description = v.paymentDescription?.trim() || undefined;

    if (v.paymentType === 'link') {
      const paymentLink = v.paymentLink?.trim();
      return paymentLink ? { type: 'link', paymentLink, description } : undefined;
    }

    const bankName = v.bankName?.trim();
    const accountName = v.accountName?.trim();
    const accountNumber = v.accountNumber?.trim();
    if (!bankName && !accountName && !accountNumber) return undefined;
    return { type: 'bank', bankName, accountName, accountNumber, description };
  }

  protected markAsBranch(): void {
    const parentId = this.selectedParentId();
    if (!parentId || this.markingAsBranch()) return;
    // The picker page is cached by the ROOT's slug, so invalidate the parent
    // being attached to — its branch list is about to gain this salon.
    const parentSlug = this.eligibleParentSalons().find((s) => s.id === parentId)?.slug;
    this.markingAsBranch.set(true);
    this._salonService.attachBranch(
      this._salonId,
      parentId,
      this._destroyRef,
      () => {
        this.markingAsBranch.set(false);
        this.selectedParentId.set(null);
        if (parentSlug) this._branchPicker.invalidate(parentSlug);
        this._overview.invalidate(this._salonId);
        this._overview.refresh(this._salonId, this._currentUser.user()?.id ?? '');
      },
      (code) => {
        this.markingAsBranch.set(false);
        if (code === ErrorCodes.ALREADY_A_BRANCH) {
          this._toast.error('This salon is already a branch.');
        } else if (code === ErrorCodes.BRANCH_DIFFERENT_ORG) {
          this._toast.error('Branches must belong to the same organization.');
        }
        // Other codes (INVALID_BRANCH etc.) fall through to the interceptor's
        // generic body.message toast — SalonService.attachBranch's error
        // handler doesn't suppress it, this callback is additive.
      },
    );
  }

  protected unbranch(): void {
    if (this.unbranching()) return;
    this._renameDialog
      .open({
        title: 'Remove from branch group',
        message: 'This salon will become standalone again. Choose a new name for it.',
        confirmLabel: 'Remove branch',
        minLength: 2,
      })
      .pipe(
        filter((name): name is string => !!name),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((newName) => {
        // Captured before the call — the detach response no longer carries the
        // parent relationship, and the picker cache is keyed by the root's slug.
        const parentSlug = (this._overview.salon() ?? this._settings.salon())?.parent?.slug;
        this.unbranching.set(true);
        this._salonService.detachBranch(
          this._salonId,
          newName,
          this._destroyRef,
          () => {
            this.unbranching.set(false);
            if (parentSlug) this._branchPicker.invalidate(parentSlug);
            this._overview.invalidate(this._salonId);
            this._overview.refresh(this._salonId, this._currentUser.user()?.id ?? '');
          },
          () => this.unbranching.set(false),
        );
      });
  }
}
