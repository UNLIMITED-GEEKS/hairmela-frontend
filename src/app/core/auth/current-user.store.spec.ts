import { TestBed } from '@angular/core/testing';
import { UserResponseDto } from '../../api/models/user-response-dto';
import { PersistentStore } from '../storage/persistent-store';
import { CurrentUserStore } from './current-user.store';

const USER = {
  id: 'user-1',
  email: 'owner@example.com',
  firstName: 'Ada',
  lastName: 'Owner',
} as UserResponseDto;

describe('CurrentUserStore', () => {
  it('restores a valid cached profile and removes it on clear', () => {
    const values = new Map<string, unknown>([['hm_current_user', USER]]);
    const storage = {
      get: (key: string) => values.get(key) ?? null,
      set: (key: string, value: unknown) => values.set(key, value),
      remove: (key: string) => values.delete(key),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: PersistentStore, useValue: storage }],
    });
    const store = TestBed.inject(CurrentUserStore);

    expect(store.restoreFromStorage()).toBe(true);
    expect(store.user()).toEqual(USER);

    store.clear();

    expect(store.user()).toBeNull();
    expect(values.has('hm_current_user')).toBe(false);
  });

  it('rejects malformed cached identity data', () => {
    const remove = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PersistentStore,
          useValue: { get: () => ({ id: 'user-1' }), remove, set: vi.fn() },
        },
      ],
    });
    const store = TestBed.inject(CurrentUserStore);

    expect(store.restoreFromStorage()).toBe(false);
    expect(store.user()).toBeNull();
    expect(remove).toHaveBeenCalledWith('hm_current_user');
  });
});
