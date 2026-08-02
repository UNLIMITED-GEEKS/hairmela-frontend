import { Component, computed, inject } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { StaffService } from '../staff.service';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonRole } from '../../../core/salon-context/membership.types';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { RouteParam, RoutePath } from '../../../core/routing/route-paths';

@Component({
  selector: 'app-invite-staff',
  templateUrl: './invite-staff.component.html',
  imports: [ReactiveFormsModule, FieldErrorComponent, PageHeaderComponent],
})
export class InviteStaffComponent {
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _fb = inject(FormBuilder);
  private readonly _staffService = inject(StaffService);
  private readonly _salonContext = inject(SalonContextService);

  // Pre-block (handoff §3): Tier 1 allows only the owner (staff limit = 1), so
  // any invite exceeds it — block on tier === 1. Tier 2/3 are unlimited.
  // A frozen salon rejects all writes. The backend still enforces both; this is
  // honest UI so the user sees the nudge instead of a 403.
  protected readonly tierBlocked = computed(() => this._salonContext.tier() === 1);
  protected readonly frozen = computed(() => this._salonContext.isFrozen());
  protected readonly blocked = computed(() => this.tierBlocked() || this.frozen());

  // Billing is ORG-OWNER-only server-side (every subscription route is
  // class-level @OrgOwner(); OrgOwnerGuard 403s when org.ownerId !== user.id),
  // and this page is reachable by ADMINs too — so the blocked notice still
  // shows for them, but the "View plans" CTA is owner-only. Without this an
  // admin's click bounced to /dashboard via the frontend orgOwnerGuard.
  protected readonly isOwner = computed(
    () => this._salonContext.membership()?.role === SalonRole.OWNER,
  );

  // This salon's membership already carries orgId (GET /salons/:salonId/me) —
  // navigate straight there instead of OrgContextService.goToBilling()'s
  // GET /organizations/mine round-trip, which made this click wait on a live
  // network call purely to learn an orgId already sitting in membership().
  protected viewPlans(): void {
    const orgId = this._salonContext.membership()?.orgId;
    if (!orgId) return;
    this._router.navigate(RoutePath.orgBilling(orgId));
  }

  protected readonly form = this._fb.group({
    email: ['', [Validators.required, Validators.email]],
    role: ['STAFF' as 'ADMIN' | 'STAFF', Validators.required],
  });

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get(RouteParam.SALON_ID) ?? '';
  }

  protected invite(): void {
    if (this.blocked()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this._staffService.invite(this._salonId, {
      email: this.form.value.email!,
      role: this.form.value.role!,
    });
    // Navigate immediately — temp invite is already in the list. replaceUrl
    // swaps out this form's history entry so a later browser-back doesn't
    // bounce through the stale form.
    this._router.navigate(RoutePath.salonStaff(this._salonId), { replaceUrl: true });
  }
}
