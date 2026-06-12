import { Injectable, signal } from '@angular/core';
import { UserResponseDto } from '../../api/models/user-response-dto';

@Injectable({ providedIn: 'root' })
export class CurrentUserStore {
  private readonly _user = signal<UserResponseDto | null>(null);

  readonly user = this._user.asReadonly();

  set(user: UserResponseDto): void {
    this._user.set(user);
  }

  clear(): void {
    this._user.set(null);
  }
}
