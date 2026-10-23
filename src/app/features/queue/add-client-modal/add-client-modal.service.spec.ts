import { TestBed } from '@angular/core/testing';
import { AddClientModalService } from './add-client-modal.service';

// Covers which shell hosts the add-client modal. The bug this guards: the
// bottom-nav "+" always opened the modal in the auth shell, whose console is
// not the one the queue page renders, so an added client never painted its
// optimistic row on the page the barber was looking at.

const target = { salonId: 'salon-1', queueId: 'queue-1', staffId: 'staff-1' };

describe('AddClientModalService', () => {
  let service: AddClientModalService;

  beforeEach(() => {
    service = TestBed.inject(AddClientModalService);
  });

  it('is hosted by the auth shell when no queue page is open', () => {
    service.openWalkIn(target);

    expect(service.shellRequest()).toEqual({ ...target, mode: 'walk-in' });
    expect(service.pageRequest()).toBeNull();
  });

  it('is hosted by the queue page showing the same queue', () => {
    service.attachPage('queue-1');
    service.openWalkIn(target);

    expect(service.pageRequest()).toEqual({ ...target, mode: 'walk-in' });
    expect(service.shellRequest()).toBeNull();
  });

  it('stays in the auth shell when the open queue page is a different queue', () => {
    service.attachPage('queue-2');
    service.openAppointment(target);

    expect(service.shellRequest()).toEqual({ ...target, mode: 'appointment' });
    expect(service.pageRequest()).toBeNull();
  });

  it('moves between hosts when the queue page opens or closes while open', () => {
    service.openWalkIn(target);
    service.attachPage('queue-1');
    expect(service.pageRequest()).not.toBeNull();
    expect(service.shellRequest()).toBeNull();

    service.detachPage('queue-1');
    expect(service.shellRequest()).not.toBeNull();
    expect(service.pageRequest()).toBeNull();
  });

  it('ignores a detach from a page that is no longer the open one', () => {
    service.attachPage('queue-1');
    service.attachPage('queue-2');
    service.detachPage('queue-1');
    service.openWalkIn({ ...target, queueId: 'queue-2' });

    expect(service.pageRequest()).not.toBeNull();
  });

  it('close clears both hosts', () => {
    service.attachPage('queue-1');
    service.openWalkIn(target);
    service.close();

    expect(service.pageRequest()).toBeNull();
    expect(service.shellRequest()).toBeNull();
  });
});
