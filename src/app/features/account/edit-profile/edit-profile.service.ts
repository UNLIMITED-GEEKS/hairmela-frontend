import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../../api/api-configuration';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { ToastService } from '../../../core/toast/toast.service';
import { UpdateProfileDto } from '../../../api/models/update-profile-dto';
import { usersControllerUpdateProfile } from '../../../api/fn/users/users-controller-update-profile';

@Injectable({ providedIn: 'root' })
export class EditProfileService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _toast = inject(ToastService);

  update(dto: UpdateProfileDto): void {
    const prev = this._currentUser.user();
    if (!prev) return;

    // Predict: apply the form values to the current user immediately
    this._currentUser.set({
      ...prev,
      firstName: dto.firstName ?? prev.firstName,
      lastName: dto.lastName ?? prev.lastName,
      nickname: dto.nickname ?? null,
      phone: dto.phone ?? null,
    });
    // Optimistic: the store already reflects the change, so tell the user now
    // rather than waiting on the network round-trip. If the save actually
    // fails, the revert path below shows its own error toast.
    this._toast.success('Profile updated');

    // Fire HTTP in background — reconcile with server truth on success
    usersControllerUpdateProfile(this._http, this._apiConfig.rootUrl, { body: dto }).subscribe({
      next: (res) => {
        this._currentUser.set(res.body);
      },
      error: () => {
        // Revert to the previous user state
        this._currentUser.set(prev);
        this._toast.error('Failed to update profile. Reverted.');
      },
    });
  }
}
