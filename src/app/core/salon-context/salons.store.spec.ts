import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MySalonDto } from '../../api/models/my-salon-dto';
import { MembershipStore } from './membership.store';
import { SalonsStore } from './salons.store';

function salon(id: string): MySalonDto {
  return { role: 'OWNER', salon: { id } } as MySalonDto;
}

describe('SalonsStore', () => {
  let store: SalonsStore;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: MembershipStore,
          useValue: { getMembership: () => of({}) },
        },
      ],
    });
    store = TestBed.inject(SalonsStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('does not replay the previous account salons after clear', () => {
    let firstResult: MySalonDto[] | undefined;
    store.ensureLoaded().subscribe((salons) => (firstResult = salons));
    httpMock.expectOne((request) => request.url.endsWith('/v1/salons/mine')).flush([salon('salon-a')]);
    expect(firstResult?.[0].salon.id).toBe('salon-a');

    store.clear();

    let secondResult: MySalonDto[] | undefined;
    store.ensureLoaded().subscribe((salons) => (secondResult = salons));

    // The stale shareReplay value must not resolve the new account's load.
    expect(secondResult).toBeUndefined();
    httpMock.expectOne((request) => request.url.endsWith('/v1/salons/mine')).flush([salon('salon-b')]);

    expect(secondResult?.[0].salon.id).toBe('salon-b');
    expect(store.salons()[0].salon.id).toBe('salon-b');
  });
});
