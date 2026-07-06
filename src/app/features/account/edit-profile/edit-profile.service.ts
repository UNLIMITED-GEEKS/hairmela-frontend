import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ApiConfiguration } from '../../../api/api-configuration';
import { CurrentUserStore } from '../../../core/auth/current-user.store';
import { ToastService } from '../../../core/toast/toast.service';
import { UserResponseDto } from '../../../api/models/user-response-dto';
import { UpdateProfileDto } from '../../../api/models/update-profile-dto';
import { usersControllerUpdateProfile } from '../../../api/fn/users/users-controller-update-profile';
import { Observable, tap } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class EditProfileService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);
  private readonly _currentUser = inject(CurrentUserStore);
  private readonly _toast = inject(ToastService);

  private readonly _saving = signal(false);
  readonly saving = this._saving.asReadonly();

  update(dto: UpdateProfileDto): Observable<UserResponseDto> {
    this._saving.set(true);
    return usersControllerUpdateProfile(this._http, this._apiConfig.rootUrl, { body: dto }).pipe(
      map((r) => r.body),
      tap({
        next: (user) => {
          this._saving.set(false);
          this._currentUser.set(user);
          this._toast.success('Profile updated');
        },
        error: () => {
          this._saving.set(false);
        },
      }),
    );
  }
}
