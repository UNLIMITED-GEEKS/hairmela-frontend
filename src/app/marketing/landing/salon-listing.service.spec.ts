import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { provideApiConfiguration } from '../../api/api-configuration';
import { SalonListingService } from './salon-listing.service';

describe('SalonListingService pagination restoration', () => {
  let httpMock: HttpTestingController;
  let router: Router;

  function createService(page: string | null): SalonListingService {
    TestBed.configureTestingModule({
      providers: [
        SalonListingService,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApiConfiguration('https://api.example.com'),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap(page ? { page } : {}) },
          },
        },
        {
          provide: Router,
          useValue: { navigate: vi.fn() },
        },
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    return TestBed.inject(SalonListingService);
  }

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  it('loads the page stored in the URL when returning to the listing', () => {
    const service = createService('3');

    expect(service.page()).toBe(3);
    const request = httpMock.expectOne(
      (req) => req.url === 'https://api.example.com/v1/salons' && req.params.get('page') === '3',
    );
    request.flush({ data: [], meta: { page: 3, limit: 18, total: 0, totalPages: 3 } });
  });

  it('writes page changes to the current URL without creating pagination history entries', () => {
    const service = createService(null);
    httpMock
      .expectOne((req) => req.params.get('page') === '1')
      .flush({
        data: [],
        meta: { page: 1, limit: 18, total: 54, totalPages: 3 },
      });

    service.goToPage(3);

    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: TestBed.inject(ActivatedRoute),
      queryParams: { page: 3 },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    httpMock
      .expectOne((req) => req.params.get('page') === '3')
      .flush({
        data: [],
        meta: { page: 3, limit: 18, total: 54, totalPages: 3 },
      });
  });

  it('ignores an invalid page in the URL', () => {
    const service = createService('-2');

    expect(service.page()).toBe(1);
    httpMock
      .expectOne((req) => req.params.get('page') === '1')
      .flush({
        data: [],
        meta: { page: 1, limit: 18, total: 0, totalPages: 0 },
      });
  });
});
