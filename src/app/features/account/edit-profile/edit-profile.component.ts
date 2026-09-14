import { Component, inject, OnInit, viewChild, ElementRef, Injector, afterNextRender } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { EditProfileService } from './edit-profile.service';
import { FieldErrorComponent } from '../../../shared/components/field-error/field-error.component';
import { RoutePath } from '../../../core/routing/route-paths';
import { scrollToFirstInvalidControl } from '../../../core/utils/scroll-to-first-invalid';
import { PhoneInputComponent } from '../../../shared/components/phone-input/phone-input.component';

@Component({
  selector: 'app-edit-profile',
  templateUrl: './edit-profile.component.html',
  imports: [ReactiveFormsModule, RouterLink, FieldErrorComponent, PhoneInputComponent],
})
export class EditProfileComponent implements OnInit {
  // The <form> element, so a blocked submit can scroll to the first
  // invalid field — see scrollToFirstInvalidControl.
  private readonly _formEl = viewChild<ElementRef<HTMLElement>>('formEl');
  private readonly _scrollInjector = inject(Injector);

  private readonly _fb = inject(FormBuilder);
  protected readonly _currentUser = inject(CurrentUserStore);
  private readonly _editProfile = inject(EditProfileService);
  private readonly _router = inject(Router);

  protected readonly accountLink = RoutePath.account();

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
    const { firstName, lastName, nickname, phone } = this.form.getRawValue();
    this._editProfile.update({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      nickname: nickname.trim() || undefined,
      phone: phone.trim() || undefined,
    });
    // Navigate immediately — profile is already predicted in the store
    this._router.navigate(RoutePath.account());
  }
}
