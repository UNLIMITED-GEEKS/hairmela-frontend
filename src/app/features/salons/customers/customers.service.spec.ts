import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiConfiguration } from '../../../api/api-configuration';
import { CacheRegistry } from '../../../core/caching/cache-registry/cache-registry.service';
import { CustomersService } from './customers.service';

describe('CustomersService caching', () => {
  let service: CustomersService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiConfiguration, useValue: { rootUrl: '' } },
      ],
    });
    service = TestBed.inject(CustomersService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('shows cached customers on a return visit while refreshing their list', () => {
    service.getSalonFavorites('salon-1').subscribe();
    http
      .expectOne((request) => request.url.endsWith('/salon-1/customers'))
      .flush({ data: [{ userId: 'customer-1' }], meta: null });
    const updates: unknown[] = [];
    service.getSalonFavorites('salon-1').subscribe((result) => updates.push(result.data));
    expect(updates).toEqual([[{ userId: 'customer-1' }]]);
    http
      .expectOne((request) => request.url.endsWith('/salon-1/customers'))
      .flush({ data: [{ userId: 'customer-1' }, { userId: 'customer-2' }], meta: null });
    expect(updates).toHaveLength(2);
  });

  it('does not reuse another salon, page, or search result and clears on logout', () => {
    service.getSalonFavorites('salon-1').subscribe();
    http.expectOne((request) => request.url.endsWith('/salon-1/customers')).flush({ data: [] });
    service.getSalonFavorites('salon-2').subscribe();
    service.getSalonFavorites('salon-1', 2).subscribe();
    service.getSalonFavorites('salon-1', 1, 100, ' Ada ').subscribe();
    http.expectOne((request) => request.url.endsWith('/salon-2/customers')).flush({ data: [] });
    http.expectOne((request) => request.params.get('page') === '2').flush({ data: [] });
    http.expectOne((request) => request.params.get('search') === 'Ada').flush({ data: [] });
    TestBed.inject(CacheRegistry).clearAll();
    const updates: unknown[] = [];
    service.getSalonFavorites('salon-1').subscribe((result) => updates.push(result.data));
    expect(updates).toEqual([]);
    http.expectOne((request) => request.url.endsWith('/salon-1/customers')).flush({ data: [] });
  });
});
