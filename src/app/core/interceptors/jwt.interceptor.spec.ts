import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { GuestStore } from '../guest/guest-store';
import { TokenStore } from '../auth/token.store';
import { jwtInterceptor } from './jwt.interceptor';
import { environment } from '../../../environments/environment';

describe('jwtInterceptor guest identity', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let guestStore: GuestStore;
  let tokenStore: TokenStore;

  const api = environment.apiBaseUrl;
  const guestToken = 'guest-token-one';

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([jwtInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    guestStore = TestBed.inject(GuestStore);
    tokenStore = TestBed.inject(TokenStore);
    tokenStore.clearTokens();
    guestStore.setToken(guestToken);
  });

  afterEach(() => httpMock.verify());

  it('reuses one guest token for repeated bookings and a walk-in', () => {
    const bookingUrl = `${api}/v1/salons/salon-id/queues/queue-id/appointments`;
    const walkInUrl = `${api}/v1/salons/salon-id/queues/queue-id/walk-in`;

    http.post(bookingUrl, {}).subscribe();
    http.post(bookingUrl, {}).subscribe();
    http.post(walkInUrl, {}).subscribe();

    for (const request of httpMock.match(bookingUrl)) {
      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${guestToken}`);
      request.flush({});
    }
    const walkIn = httpMock.expectOne(walkInUrl);
    expect(walkIn.request.headers.get('Authorization')).toBe(`Bearer ${guestToken}`);
    walkIn.flush({});
  });

  it('uses the guest token for appointment follow-up routes', () => {
    const urls = [
      `${api}/v1/salons/salon-id/queues/queue-id/appointments/entry-id`,
      `${api}/v1/salons/salon-id/queues/queue-id/appointments/entry-id/reschedule`,
      `${api}/v1/salons/salon-id/queues/queue-id/receipt-verification`,
      `${api}/v1/queues/queue-id/entries/entry-id`,
    ];

    for (const url of urls) http.get(url).subscribe();

    for (const url of urls) {
      const request = httpMock.expectOne(url);
      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${guestToken}`);
      request.flush({});
    }
  });

  it('does not send a guest token to unrelated protected routes', () => {
    const url = `${api}/v1/organizations/mine`;
    http.get(url).subscribe();

    const request = httpMock.expectOne(url);
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
  });
});
