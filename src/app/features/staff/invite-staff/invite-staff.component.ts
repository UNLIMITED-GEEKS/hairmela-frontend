import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { StaffService } from '../staff.service';
import { isApiError } from '../../../core/errors/api-error.types';
import { ErrorCodes } from '../../../core/errors/error-codes';

@Component({
  selector: 'app-invite-staff',
  templateUrl: './invite-staff.component.html',
  imports: [ReactiveFormsModule, RouterLink],
})
export class InviteStaffComponent {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _fb = inject(FormBuilder);
  private readonly _staffService = inject(StaffService);

  protected readonly saving = this._staffService.acting;

  protected readonly form = this._fb.group({
    email: ['', [Validators.required, Validators.email]],
    role: ['STAFF' as 'ADMIN' | 'STAFF', Validators.required],
  });

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  protected invite(): void {
    if (this.form.invalid || this.saving()) return;
    this._staffService.invite(
      this._salonId,
      { email: this.form.value.email!, role: this.form.value.role! },
      () => this._router.navigate(['..'], { relativeTo: this._route }),
    );
  }
}
