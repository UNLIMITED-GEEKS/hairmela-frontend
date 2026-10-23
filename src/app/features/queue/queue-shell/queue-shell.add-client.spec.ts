import { TestBed, ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { QueueShellComponent } from './queue-shell.component';
import { QueueConsoleService } from '../queue-console/queue-console.service';
import { AddClientModalComponent } from '../add-client-modal/add-client-modal.component';
import { AddClientModalService } from '../add-client-modal/add-client-modal.service';
import { SalonContextService } from '../../../core/salon-context/salon-context.service';
import { SalonSettingsService } from '../../salons/salon-settings/salon-settings.service';
import { RouteParam } from '../../../core/routing/route-paths';

// The bug this guards: the bottom-nav "+" opened the add-client modal in the
// auth shell, on that shell's own QueueConsoleService. The add painted its
// optimistic temp row into that console, which the queue page never renders,
// so the page showed nothing until the server's socket frame arrived.
//
// The fix routes the request to this shell while it shows the same queue. What
// matters is that the modal it renders runs on THIS shell's console — the one
// the page draws its timeline from — so that is what these tests assert.

const SALON_ID = 'salon-1';
const QUEUE_ID = 'queue-1';

function fakeConsole() {
  return {
    loading: signal(true),
    staffServices: signal([]),
    allowsWalkIns: signal(true),
    maxPartySize: signal(5),
    init: vi.fn(),
    destroy: vi.fn(),
  };
}

describe('QueueShellComponent add-client hosting', () => {
  let fixture: ComponentFixture<QueueShellComponent>;
  let shellConsole: ReturnType<typeof fakeConsole>;
  let addClient: AddClientModalService;

  beforeEach(() => {
    shellConsole = fakeConsole();
    TestBed.configureTestingModule({
      imports: [QueueShellComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({
                [RouteParam.SALON_ID]: SALON_ID,
                [RouteParam.QUEUE_ID]: QUEUE_ID,
              }),
            },
          },
        },
        { provide: SalonContextService, useValue: { staffFrozen: signal(false) } },
        { provide: SalonSettingsService, useValue: { load: vi.fn(), salon: signal(null) } },
      ],
    });
    TestBed.overrideComponent(QueueShellComponent, {
      set: { providers: [{ provide: QueueConsoleService, useValue: shellConsole }] },
    });
    addClient = TestBed.inject(AddClientModalService);
    fixture = TestBed.createComponent(QueueShellComponent);
    fixture.detectChanges();
  });

  function hostedModal() {
    return fixture.debugElement.query(By.directive(AddClientModalComponent));
  }

  it('hosts a request for its own queue on the page console', () => {
    addClient.openWalkIn({ salonId: SALON_ID, queueId: QUEUE_ID, staffId: 'staff-1' });
    fixture.detectChanges();

    const modal = hostedModal();
    expect(modal).not.toBeNull();
    expect(modal.injector.get(QueueConsoleService)).toBe(shellConsole);
    expect(addClient.shellRequest()).toBeNull();
  });

  it('leaves a request for another queue to the auth shell', () => {
    addClient.openWalkIn({ salonId: SALON_ID, queueId: 'queue-2', staffId: 'staff-2' });
    fixture.detectChanges();

    expect(hostedModal()).toBeNull();
    expect(addClient.shellRequest()).not.toBeNull();
  });

  it('hands an open request back to the auth shell when the page closes', () => {
    addClient.openWalkIn({ salonId: SALON_ID, queueId: QUEUE_ID, staffId: 'staff-1' });
    fixture.detectChanges();

    fixture.destroy();

    expect(addClient.shellRequest()).not.toBeNull();
    expect(shellConsole.destroy).toHaveBeenCalledWith(QUEUE_ID);
  });
});
