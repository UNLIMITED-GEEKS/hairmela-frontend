import { Injectable, inject, signal } from '@angular/core';
import { UserResponseDto } from '../../api/models/user-response-dto';
import { PersistentStore } from '../storage/persistent-store';

const CURRENT_USER_KEY = 'hm_current_user';

function isStoredUser(value: unknown): value is UserResponseDto {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<UserResponseDto>;
  return (
    typeof user.id === 'string' &&
    typeof user.email === 'string' &&
    typeof user.firstName === 'string' &&
    typeof user.lastName === 'string'
  );
}

@Injectable({ providedIn: 'root' })
export class CurrentUserStore {
  private readonly _storage = inject(PersistentStore);
  private readonly _user = signal<UserResponseDto | null>(null);
  private _restored = false;

  readonly user = this._user.asReadonly();

  set(user: UserResponseDto): void {
    this._user.set(user);
    this._storage.set(CURRENT_USER_KEY, user);
    this._restored = true;
  }

  restoreFromStorage(): boolean {
    if (this._restored) return this._user() !== null;
    this._restored = true;

    const stored = this._storage.get<unknown>(CURRENT_USER_KEY);
    if (!isStoredUser(stored)) {
      if (stored !== null) this._storage.remove(CURRENT_USER_KEY);
      return false;
    }

    this._user.set(stored);
    return true;
  }

  clear(): void {
    this._user.set(null);
    this._storage.remove(CURRENT_USER_KEY);
    this._restored = true;
  }
}
