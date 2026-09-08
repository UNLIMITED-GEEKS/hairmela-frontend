import { Component, OnInit, computed, inject, signal, viewChild, ElementRef, Injector, afterNextRender } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { StaffService } from '../staff.service';
import { ServicesService } from '../../services/services.service';
import { Service } from '../../../api/models/service';
import { groupByServiceCategory } from '../../../core/utils/group-by-category';
import { AccordionComponent } from '../../../shared/components/accordion/accordion.component';
import { CurrencyNgnPipe } from '../../../shared/pipes/currency-ngn.pipe';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonRole } from '../../../core/salon-context/membership.types';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';
import { scrollToFirstInvalidControl } from '../../../core/utils/scroll-to-first-invalid';

@Component({
  selector: 'app-invite-staff',
  templateUrl: './invite-staff.component.html',
  imports: [
    ReactiveFormsModule,
    FieldErrorComponent,
    PageHeaderComponent,
    AccordionComponent,
    CurrencyNgnPipe,
  ],
})
export class InviteStaffComponent implements OnInit {
  // The <form> element, so a blocked submit can scroll to the first
  // invalid field — see scrollToFirstInvalidControl.
  private readonly _formEl = viewChild<ElementRef<HTMLElement>>('formEl');
  private readonly _scrollInjector = inject(Injector);

  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _fb = inject(FormBuilder);
  private readonly _staffService = inject(StaffService);
  private readonly _servicesService = inject(ServicesService);
  // Protected (not private): the template reads currency() for service prices.
  protected readonly salonContext = inject(SalonContextService);

  // A frozen salon rejects all writes, so the form is pre-blocked with a
  // nudge rather than letting the user fill it in and collect a 403.
  //
  // NO TIER BLOCK. This used to also block tier 1 ("Standard allows only the
  // owner"), which was true when that tier had a staff limit of 1. Every paid
  // tier is UNLIMITED now — backend STAFF_LIMITS has STANDARD/PRO/SCALE all
  // UNLIMITED, and this app's own STAFF_LIMIT agrees — so the check was
  // refusing invites the backend would have accepted, and its "Upgrade to Pro"
  // advice pointed at a tier with the identical limit.
  //
  // If a staff limit ever returns, the backend still enforces it and answers
  // STAFF_LIMIT_REACHED, which error.interceptor.ts already surfaces.
  protected readonly frozen = computed(() => this.salonContext.isFrozen());
  protected readonly blocked = this.frozen;

  // Billing is ORG-OWNER-only server-side (every subscription route is
  // class-level @OrgOwner(); OrgOwnerGuard 403s when org.ownerId !== user.id),
  // and this page is reachable by ADMINs too — so the blocked notice still
  // shows for them, but the "View plans" CTA is owner-only. Without this an
  // admin's click bounced to /dashboard via the frontend orgOwnerGuard.
  protected readonly isOwner = computed(
    () => this.salonContext.membership()?.role === SalonRole.OWNER,
  );

  // This salon's membership already carries orgId (GET /salons/:salonId/me) —
  // navigate straight there instead of OrgContextService.goToBilling()'s
  // GET /organizations/mine round-trip, which made this click wait on a live
  // network call purely to learn an orgId already sitting in membership().
  protected viewPlans(): void {
    const orgId = this.salonContext.membership()?.orgId;
    if (!orgId) return;
    this._router.navigate(RoutePath.orgBilling(orgId));
  }

  protected readonly form = this._fb.group({
    email: ['', [Validators.required, Validators.email]],
    role: ['STAFF' as 'ADMIN' | 'STAFF', Validators.required],
    // Optional: an invite with nothing picked is valid, and omits serviceIds
    // entirely rather than sending [] (see invite()).
    serviceIds: [[] as string[]],
  });

  // ── Services picker ──────────────────────────────────────────────────────
  //
  // Only active services can be offered, and they are grouped into the same
  // category accordions used by the services list and the staff-assign page,
  // so a salon with a long menu is navigable here too.
  protected readonly serviceGroups = computed(() =>
    groupByServiceCategory(
      this._servicesService.services().filter((s) => s.isActive),
      (s: Service) => s,
    ),
  );

  protected readonly servicesLoading = this._servicesService.loading;

  // Which category accordions are expanded. All start closed: the picker is
  // optional, and an invite is usually just email + role.
  private readonly _openCategories = signal<ReadonlySet<string>>(new Set());

  protected isCategoryOpen(categoryId: string): boolean {
    return this._openCategories().has(categoryId);
  }

  protected setCategoryOpen(categoryId: string, open: boolean): void {
    this._openCategories.update((prev) => {
      const next = new Set(prev);
      if (open) next.add(categoryId);
      else next.delete(categoryId);
      return next;
    });
  }

  protected isServiceChecked(serviceId: string): boolean {
    return (this.form.controls.serviceIds.value ?? []).includes(serviceId);
  }

  protected toggleService(serviceId: string, checked: boolean): void {
    const current = this.form.controls.serviceIds.value ?? [];
    const next = checked
      ? [...current, serviceId]
      : current.filter((id) => id !== serviceId);
    this.form.controls.serviceIds.setValue(next);
  }

  // Count for the section header, so a collapsed picker still shows what was
  // chosen without expanding every category.
  //
  // A plain getter, NOT a computed(): a FormControl's value is not a signal, so
  // a computed over it would be captured once and never update. Same reason the
  // barber add-client modal uses getters for its party-size checks.
  protected get selectedCount(): number {
    return (this.form.controls.serviceIds.value ?? []).length;
  }

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  ngOnInit(): void {
    // Cached loader — a no-op when the services list is already warm from the
    // services page or the service form.
    this._servicesService.load(this._salonId);
  }

  protected invite(): void {
    if (this.blocked()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      // Deferred: markAllAsTouched only renders the error messages on the next
      // change detection pass, and those messages shift layout.
      afterNextRender(
        () => scrollToFirstInvalidControl(this._formEl()?.nativeElement),
        { injector: this._scrollInjector },
      );
      return;
    }
    // serviceIds is OMITTED when nothing was picked rather than sent as [].
    // The two are not the same to the backend: [] is an explicit "no services",
    // and the field is optional precisely so an invite can stay silent on the
    // subject. Picks are held as pendingServiceIds until the invite is accepted.
    const serviceIds = this.form.value.serviceIds ?? [];
    this._staffService.invite(this._salonId, {
      email: this.form.value.email!,
      role: this.form.value.role!,
      ...(serviceIds.length ? { serviceIds } : {}),
    });
    // Navigate immediately — temp invite is already in the list. replaceUrl
    // swaps out this form's history entry so a later browser-back doesn't
    // bounce through the stale form.
    this._router.navigate(RoutePath.salonStaff(this._salonId), { replaceUrl: true });
  }
}
