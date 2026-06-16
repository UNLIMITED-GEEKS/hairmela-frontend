import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiConfiguration } from '../../../api/api-configuration';
import { staffControllerInvite } from '../../../api/fn/staff/staff-controller-invite';
import { ToastService } from '../../../core/toast/toast.service';
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
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _fb = inject(FormBuilder);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _toast = inject(ToastService);

  protected readonly saving = signal(false);

  protected readonly form = this._fb.group({
    email: ['', [Validators.required, Validators.email]],
    role: ['STAFF' as 'ADMIN' | 'STAFF', Validators.required],
  });

  private get _salonId(): string {
    return this._route.snapshot.paramMap.get('salonId') ?? '';
  }

  protected invite(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);

    staffControllerInvite(this._http, this._apiConfig.rootUrl, {
      salonId: this._salonId,
      body: {
        email: this.form.value.email!,
        role: this.form.value.role!,
      },
    }).pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this._toast.success('Invite sent');
        this._router.navigate(['..'], { relativeTo: this._route });
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const body = (err as { error?: unknown })?.error;
        if (isApiError(body) && body.code === ErrorCodes.STAFF_ALREADY_INVITED) {
          this.form.get('email')?.setErrors({ alreadyInvited: true });
        }
      },
    });
  }
}
