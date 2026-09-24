import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { UserResponseDto } from '../../api/models/user-response-dto';
import { CurrentUserService } from './current-user.service';
import { CurrentUserStore } from './current-user.store';
import { PersistentStore } from '../storage/persistent-store';

const USER = {
  id: 'user-1',
  email: 'owner@example.com',
  firstName: 'Ada',
  lastName: 'Owner',
} as UserResponseDto;

describe('CurrentUserService', () => {
  let service: CurrentUserService;
  let store: CurrentUserStore;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: PersistentStore,
          useValue: { get: () => null, set: vi.fn(), remove: vi.fn() },
        },
      ],
    });
    service = TestBed.inject(CurrentUserService);
    store = TestBed.inject(CurrentUserStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('shares one identity request across startup and guards', () => {
    let first: UserResponseDto | undefined;
    let second: UserResponseDto | undefined;

    service.ensureLoaded().subscribe((user) => (first = user));
    service.ensureLoaded().subscribe((user) => (second = user));

    httpMock.expectOne((request) => request.url.endsWith('/v1/auth/me')).flush(USER);

    expect(first).toEqual(USER);
    expect(second).toEqual(USER);
    expect(store.user()).toEqual(USER);
  });

  it('does not let a request from a cleared session repopulate the user', () => {
    service.ensureLoaded().subscribe();
    const request = httpMock.expectOne((candidate) => candidate.url.endsWith('/v1/auth/me'));

    service.clear();
    request.flush(USER);

    expect(store.user()).toBeNull();
  });
});
