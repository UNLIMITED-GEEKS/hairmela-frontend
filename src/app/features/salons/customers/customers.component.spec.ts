import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ApiConfiguration } from '../../../api/api-configuration';
import { ChatService } from '../../../core/chat/chat.service';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { ToastService } from '../../../core/toast/toast.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { CustomersComponent } from './customers.component';

@Component({ selector: 'app-page-header', template: '<ng-content />' })
class HeaderStub {}

const customer = (name: string) => ({
  userId: name,
  displayName: name,
  firstName: name,
  lastName: '',
  email: `${name}@example.com`,
  nickname: null,
  phone: null,
  photoUrl: null,
  target: 'SALON',
  favoritedAt: '2026-10-14T10:00:00Z',
});

describe('CustomersComponent cached rendering', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'customers/:salonId', component: CustomersComponent }]),
        { provide: ApiConfiguration, useValue: { rootUrl: '' } },
        {
          provide: SalonContextService,
          useValue: {
            membership: signal({ role: 'OWNER', staffId: 'owner' }),
            activeSalonId: () => 'a',
          },
        },
        { provide: ChatService, useValue: {} },
        { provide: ToastService, useValue: { error: vi.fn() } },
      ],
    }).overrideComponent(CustomersComponent, {
      remove: { imports: [PageHeaderComponent] },
      add: { imports: [HeaderStub] },
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http
      .match((request) => request.url.startsWith('/svgs/'))
      .forEach((request) => request.flush('<svg viewBox="0 0 24 24"></svg>'));
    http.verify();
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('restores the baseline immediately on clear and ignores an older pending search response', async () => {
    const harness = await RouterTestingHarness.create('/customers/a');
    http
      .expectOne((request) => request.url.endsWith('/a/customers'))
      .flush({ data: [customer('Baseline')] });
    http.expectOne((request) => request.url.endsWith('/a/staff/favorites')).flush([]);
    harness.detectChanges();
    vi.useFakeTimers();
    const input = harness.routeNativeElement!.querySelector('input')!;
    input.value = 'Ada';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(350);
    const delayed = http.expectOne((request) => request.params.get('search') === 'Ada');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    harness.detectChanges();
    expect(harness.routeNativeElement!.textContent).toContain('Baseline');
    expect(harness.routeNativeElement!.querySelector('app-skeleton')).toBeNull();
    delayed.flush({ data: [customer('StaleSearchResult')] });
    harness.detectChanges();
    expect(harness.routeNativeElement!.textContent).not.toContain('StaleSearchResult');
    http
      .expectOne((request) => request.url.endsWith('/a/customers'))
      .flush({ data: [customer('Baseline')] });
  });

  it('reuses separate salon caches, including empty lists, without a loading or error flash on a failed refresh', async () => {
    const harness = await RouterTestingHarness.create('/customers/a');
    http.expectOne((request) => request.url.endsWith('/a/customers')).flush({ data: [] });
    http.expectOne((request) => request.url.endsWith('/a/staff/favorites')).flush([]);
    await harness.navigateByUrl('/customers/b');
    http
      .expectOne((request) => request.url.endsWith('/b/customers'))
      .flush({ data: [customer('SalonB')] });
    http.expectOne((request) => request.url.endsWith('/b/staff/favorites')).flush([]);
    harness.detectChanges();
    expect(harness.routeNativeElement!.textContent).toContain('SalonB');
    await harness.navigateByUrl('/customers/a');
    expect(harness.routeNativeElement!.textContent).not.toContain('SalonB');
    expect(harness.routeNativeElement!.querySelector('app-skeleton')).toBeNull();
    const beforeFailure = harness.routeNativeElement!.textContent;
    http
      .expectOne((request) => request.url.endsWith('/a/customers'))
      .flush({}, { status: 503, statusText: 'Offline' });
    http
      .expectOne((request) => request.url.endsWith('/a/staff/favorites'))
      .flush({}, { status: 503, statusText: 'Offline' });
    harness.detectChanges();
    expect(harness.routeNativeElement!.textContent).toBe(beforeFailure);
  });
});
