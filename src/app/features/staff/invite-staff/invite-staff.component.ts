import { Component, computed, inject } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { StaffService } from '../staff.service';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { OrgContextService } from '../../../core/salon-context/org-context.service';

@Component({
  selector: 'app-invite-staff',
  templateUrl: './invite-staff.component.html',
  imports: [ReactiveFormsModule],
})
export class InviteStaffComponent {
  protected readonly _location = inject(Location);
  private readonly _route = inject(ActivatedRoute);
  private readonly _fb = inject(FormBuilder);
  private readonly _staffService = inject(StaffService);
  private readonly _salonContext = inject(SalonContextService);
  private readonly _orgContext = inject(OrgContextService);

  // Pre-block (handoff §3): Tier 1 allows only the owner (staff limit = 1), so
  // any invite exceeds it — block on tier === 1. Tier 2/3 are unlimited.
  // A frozen salon rejects all writes. The backend still enforces both; this is
  // honest UI so the user sees the nudge instead of a 403.
  protected readonly tierBlocked = computed(() => this._salonContext.tier() === 1);
  protected readonly frozen = computed(() => this._salonContext.isFrozen());
  protected readonly blocked = computed(() => this.tierBlocked() || this.frozen());

  // Resolve the org on demand at click time (see OrgContextService.goToBilling).
  protected viewPlans(): void {
    this._orgContext.goToBilling();
  }

  protected readonly form = this._fb.group({
    email: ['', [Validators.required, Validators.email]],
    role: ['STAFF' as 'ADMIN' | 'STAFF', Validators.required],
  });

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  protected invite(): void {
    if (this.form.invalid || this.blocked()) return;
    this._staffService.invite(this._salonId, {
      email: this.form.value.email!,
      role: this.form.value.role!,
    });
    // Navigate back immediately — temp invite is already in the list
    this._location.back();
  }
}
