import { Component, inject, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { EditProfileService } from './edit-profile.service';

@Component({
  selector: 'app-edit-profile',
  templateUrl: './edit-profile.component.html',
  imports: [ReactiveFormsModule, RouterLink],
})
export class EditProfileComponent implements OnInit {
  private readonly _fb = inject(FormBuilder);
  protected readonly _currentUser = inject(CurrentUserStore);
  private readonly _editProfile = inject(EditProfileService);
  private readonly _router = inject(Router);

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
    if (this.form.invalid) return;
    const { firstName, lastName, nickname, phone } = this.form.getRawValue();
    this._editProfile.update({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      nickname: nickname.trim() || undefined,
      phone: phone.trim() || undefined,
    });
    // Navigate immediately — profile is already predicted in the store
    this._router.navigate(['/account']);
  }
}
