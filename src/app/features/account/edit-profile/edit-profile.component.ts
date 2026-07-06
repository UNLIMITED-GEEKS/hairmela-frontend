import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { EditProfileService } from './edit-profile.service';
import { isApiError } from '../../../core/errors/api-error.types';
import { ToastService } from '../../../core/toast/toast.service';

@Component({
  selector: 'app-edit-profile',
  templateUrl: './edit-profile.component.html',
  imports: [ReactiveFormsModule, RouterLink],
})
export class EditProfileComponent implements OnInit {
  private readonly _fb = inject(FormBuilder);
  protected readonly _currentUser = inject(CurrentUserStore);
  private readonly _editProfile = inject(EditProfileService);
  private readonly _toast = inject(ToastService);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);

  protected readonly saving = this._editProfile.saving;

  protected readonly form = this._fb.nonNullable.group({
    firstName: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(50)]],
    lastName: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(50)]],
    nickname: ['', [Validators.maxLength(50)]],
    phone: [''],
  });

  ngOnInit(): void {
    const user = this._currentUser.user();
    if (!user) return;
    this.form.patchValue({
      firstName: user.firstName,
      lastName: user.lastName,
      nickname: user.nickname ?? '',
      phone: user.phone ?? '',
    });
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) return;
    const { firstName, lastName, nickname, phone } = this.form.getRawValue();
    this._editProfile
      .update({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        nickname: nickname.trim() || undefined,
        phone: phone.trim() || undefined,
      })
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: () => this._router.navigate(['/account']),
        error: (err) => {
          if (isApiError(err?.error) && err.error.statusCode === 400 && err.error.details) {
            for (const d of err.error.details) {
              const control = this.form.get(d.field);
              if (control) control.setErrors({ server: d.constraint });
            }
          } else {
            this._toast.error('Failed to update profile');
          }
        },
      });
  }
}
