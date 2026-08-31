import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { ServiceFormComponent } from './service-form.component';
import { ServicesService } from '../services.service';
import { UpdateServiceDto } from '../../../api/models/update-service-dto';
import { CreateServiceDto } from '../../../api/models/create-service-dto';

// Focuses on the staffIds wiring in the create/edit form — the two bits most
// likely to silently misbehave: (1) an untouched checklist on EDIT must NOT
// send staffIds (backend treats omitted as "leave assignments untouched", so
// sending [] would wipe them), and (2) a touched checklist must send the full
// selection. Plus the checkbox toggle round-trip.
//
// save() has TWO paths and both are covered below:
//   - checklist dirty  → submits immediately
//   - checklist clean  → opens the assign-staff dialog, which IS the submit
//                        step; the request goes out from onAssignConfirmed().
// Tests that do not toggleStaff() must therefore drive the dialog, or nothing
// is ever sent.

class MockServicesService {
  createBody: CreateServiceDto | null = null;
  updateBody: UpdateServiceDto | null = null;
  loading = () => false;
  services = () => [];
  load(): void {}
  create(_salonId: string, body: CreateServiceDto): void {
    this.createBody = body;
  }
  update(_salonId: string, _serviceId: string, body: UpdateServiceDto): void {
    this.updateBody = body;
  }
}

function configure(params: Record<string, string>) {
  const services = new MockServicesService();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      // Wildcard route so save()'s post-success navigate() resolves instead of
      // throwing an unhandled NG04002 against an empty router config.
      provideRouter([{ path: '**', children: [] }]),
      { provide: ServicesService, useValue: services },
      {
        provide: ActivatedRoute,
        // SalonContextService (a transitive dep) walks snapshot.firstChild and
        // reads queryParamMap, so the mock must supply both, not just paramMap.
        useValue: {
          snapshot: {
            paramMap: convertToParamMap(params),
            params,
            queryParamMap: convertToParamMap({}),
            firstChild: null,
          },
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(ServiceFormComponent);
  const cmp = fixture.componentInstance as unknown as {
    form: {
      patchValue(v: Record<string, unknown>): void;
      controls: { staffIds: { value: string[] } };
    };
    toggleStaff(id: string, checked: boolean): void;
    isStaffChecked(id: string): boolean;
    save(): void;
    // save() only submits directly when the checklist is dirty; otherwise it
    // opens the assign-staff dialog, and THIS is where the request goes out.
    assignOpen: { (): boolean; set(v: boolean): void };
    onAssignConfirmed(result: { staffIds: string[]; changed: boolean }): void;
  };
  return { cmp, services };
}

describe('ServiceFormComponent — staffIds wiring', () => {
  const validCore = { categoryId: 'c1', name: 'Cut', duration: 30, price: 5000 };

  it('toggleStaff adds and removes ids, and isStaffChecked reflects it', () => {
    const { cmp } = configure({ salonId: 's1' });
    expect(cmp.isStaffChecked('a')).toBe(false);
    cmp.toggleStaff('a', true);
    cmp.toggleStaff('b', true);
    expect(cmp.form.controls.staffIds.value).toEqual(['a', 'b']);
    expect(cmp.isStaffChecked('a')).toBe(true);
    cmp.toggleStaff('a', false);
    expect(cmp.form.controls.staffIds.value).toEqual(['b']);
  });

  it('create with an untouched checklist opens the assign dialog rather than submitting', () => {
    const { cmp, services } = configure({ salonId: 's1' });
    cmp.form.patchValue(validCore);
    cmp.save();
    expect(cmp.assignOpen()).toBe(true);
    expect(services.createBody).toBeNull();
  });

  it('create always sends staffIds (even empty)', () => {
    const { cmp, services } = configure({ salonId: 's1' });
    cmp.form.patchValue(validCore);
    cmp.save();
    // Dismissed without picking anyone — create must still send [], because
    // on create there are no existing assignments to preserve.
    cmp.onAssignConfirmed({ staffIds: [], changed: false });
    expect(services.createBody).not.toBeNull();
    expect(services.createBody!.staffIds).toEqual([]);
  });

  it('create sends the toggled selection', () => {
    const { cmp, services } = configure({ salonId: 's1' });
    cmp.form.patchValue(validCore);
    cmp.toggleStaff('a', true);
    cmp.save();
    expect(services.createBody!.staffIds).toEqual(['a']);
  });

  it('edit WITHOUT touching the checklist omits staffIds entirely', () => {
    const { cmp, services } = configure({ salonId: 's1', serviceId: 'svc1' });
    // Simulate the pre-check that the load effect does — patchValue does NOT
    // mark the control dirty, mirroring the real edit-mode pre-population.
    cmp.form.patchValue({ ...validCore, staffIds: ['a', 'b'] });
    cmp.save();
    // Clean checklist → the dialog is the submit step. Confirming it unchanged
    // must NOT mark the control dirty, so staffIds stays off the payload and
    // the backend leaves the existing assignments alone.
    cmp.onAssignConfirmed({ staffIds: ['a', 'b'], changed: false });
    expect(services.updateBody).not.toBeNull();
    expect('staffIds' in services.updateBody!).toBe(false);
  });

  it('edit sends staffIds when the dialog reports a change', () => {
    const { cmp, services } = configure({ salonId: 's1', serviceId: 'svc1' });
    cmp.form.patchValue({ ...validCore, staffIds: ['a', 'b'] });
    cmp.save();
    cmp.onAssignConfirmed({ staffIds: ['a', 'c'], changed: true });
    expect(services.updateBody!.staffIds).toEqual(['a', 'c']);
  });

  it('edit WITH a checklist change sends the full current selection', () => {
    const { cmp, services } = configure({ salonId: 's1', serviceId: 'svc1' });
    cmp.form.patchValue({ ...validCore, staffIds: ['a', 'b'] });
    cmp.toggleStaff('c', true); // marks the control dirty
    cmp.save();
    expect(services.updateBody!.staffIds).toEqual(['a', 'b', 'c']);
  });
});
