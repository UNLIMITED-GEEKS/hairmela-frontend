import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { vi } from 'vitest';
import { scrollToFirstInvalidControl } from './scroll-to-first-invalid';

// Deliberately a REAL reactive form, not hand-written HTML with ng-invalid
// classes. The utility rests on Angular putting `ng-invalid` on the element
// carrying formControlName — asserting that against markup we wrote ourselves
// would only prove our own fixture, not Angular's behaviour.
//
// Field order here is chosen to expose the bug the design exists for: the form
// model declares `nested` before `later`, while the template renders `later`
// first. A model-order walk would scroll past what the user can see.
@Component({
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <form #formEl [formGroup]="form">
      <input formControlName="first" />
      <input formControlName="later" />
      <div formGroupName="nested">
        <input formControlName="inner" />
      </div>
      @if (showConditional()) {
        <input formControlName="conditional" />
      }
    </form>
  `,
})
class HostComponent {
  private readonly _fb = new FormBuilder();
  readonly showConditional = signal(true);
  readonly form = this._fb.group({
    first: [''],
    nested: this._fb.group({ inner: ['', Validators.required] }),
    later: ['', Validators.required],
    conditional: ['', Validators.required],
  });
}

describe('scrollToFirstInvalidControl', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const formEl = fixture.nativeElement.querySelector('form') as HTMLElement;
    const inputs = Array.from(
      fixture.nativeElement.querySelectorAll('input'),
    ) as HTMLElement[];

    // jsdom gives every element a null offsetParent, which the utility reads
    // as "not rendered". Make them all visible by default; individual tests
    // override this to exercise the skip path.
    inputs.forEach((el) => {
      Object.defineProperty(el, 'offsetParent', { value: formEl, configurable: true });
      el.scrollIntoView = vi.fn();
      el.focus = vi.fn();
      // jsdom reports an all-zero rect, which the visibility guard would read
      // as "on screen". Default every field to BELOW the fold so the scroll
      // path is the one under test; the guard has its own test below.
      el.getBoundingClientRect = (() =>
        ({ top: 5000, bottom: 5040 })) as unknown as HTMLElement['getBoundingClientRect'];
    });

    return { fixture, formEl, inputs };
  }

  it('does nothing when the form is valid', () => {
    const { fixture, formEl, inputs } = setup();
    fixture.componentInstance.form.patchValue({
      later: 'x',
      conditional: 'x',
      nested: { inner: 'x' },
    });
    fixture.detectChanges();

    scrollToFirstInvalidControl(formEl);
    inputs.forEach((el) => expect(el.scrollIntoView).not.toHaveBeenCalled());
  });

  it('scrolls to the first invalid field in DOM order, not model order', () => {
    const { fixture, formEl, inputs } = setup();
    fixture.detectChanges();

    // The model lists `nested` BEFORE `later`; the template renders `later`
    // first. DOM order must win — otherwise the user is sent past an error
    // sitting right in front of them.
    scrollToFirstInvalidControl(formEl);

    const later = inputs[1];
    expect(later.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(inputs[2].scrollIntoView).not.toHaveBeenCalled();
  });

  it('finds controls inside nested groups', () => {
    const { fixture, formEl, inputs } = setup();
    fixture.componentInstance.form.patchValue({ later: 'x', conditional: 'x' });
    fixture.detectChanges();

    // Only the nested control is invalid now. Nesting needs no special
    // handling because the DOM query is already flat.
    scrollToFirstInvalidControl(formEl);
    expect(inputs[2].scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('skips an invalid control that is not rendered', () => {
    const { fixture, formEl, inputs } = setup();
    fixture.componentInstance.form.patchValue({ later: 'x' });
    fixture.detectChanges();

    // `conditional` is invalid but has no layout box — scrolling to it would
    // land on nothing, so it is skipped in favour of the next candidate.
    Object.defineProperty(inputs[3], 'offsetParent', { value: null, configurable: true });

    scrollToFirstInvalidControl(formEl);
    expect(inputs[3].scrollIntoView).not.toHaveBeenCalled();
    expect(inputs[2].scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('focuses without a second scroll, so the smooth scroll is not cancelled', () => {
    const { fixture, formEl, inputs } = setup();
    fixture.detectChanges();

    scrollToFirstInvalidControl(formEl);
    expect(inputs[1].focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('scrolls only ONE field, so fixing errors one at a time works', () => {
    const { fixture, formEl, inputs } = setup();
    fixture.detectChanges();

    scrollToFirstInvalidControl(formEl);
    const scrolled = inputs.filter(
      (el) => (el.scrollIntoView as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0,
    );
    expect(scrolled.length).toBe(1);
  });

  it('is stateless — a second call re-answers against the CURRENT DOM', () => {
    const { fixture, formEl, inputs } = setup();
    fixture.detectChanges();

    scrollToFirstInvalidControl(formEl);
    expect(inputs[1].scrollIntoView).toHaveBeenCalledTimes(1);

    // User fixes that field and submits again — the next call must find the
    // NEXT invalid control, with no memory of what it reported before.
    fixture.componentInstance.form.patchValue({ later: 'x' });
    fixture.detectChanges();

    scrollToFirstInvalidControl(formEl);
    expect(inputs[2].scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('focuses but does NOT scroll a field already on screen', () => {
    const { fixture, formEl, inputs } = setup();
    fixture.detectChanges();

    // Short forms (login, forgot-password) fit entirely on screen. Centring a
    // field the user is already looking at is an unrequested jump.
    inputs[1].getBoundingClientRect = (() =>
      ({ top: 100, bottom: 140 })) as unknown as HTMLElement['getBoundingClientRect'];

    scrollToFirstInvalidControl(formEl);
    expect(inputs[1].scrollIntoView).not.toHaveBeenCalled();
    expect(inputs[1].focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('scrolls a field only partly visible at the fold', () => {
    const { fixture, formEl, inputs } = setup();
    fixture.detectChanges();

    // Half-cut by the viewport edge: the input can be seen, but the error
    // message rendered BELOW it cannot — which is the thing worth reading.
    inputs[1].getBoundingClientRect = (() =>
      ({ top: window.innerHeight - 10, bottom: window.innerHeight + 30 })) as unknown as HTMLElement['getBoundingClientRect'];

    scrollToFirstInvalidControl(formEl);
    expect(inputs[1].scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('does not throw on a null form element', () => {
    expect(() => scrollToFirstInvalidControl(null)).not.toThrow();
  });

  it('scrolls a field below a DIALOG fold, not just below the viewport fold', () => {
    // The dialogs put their fields in an inner overflow-y-auto panel. Measured
    // against window.innerHeight such a field IS inside the viewport, so it
    // was judged visible and never scrolled to — the exact case this exists
    // for, in the surface where it matters most.
    const panel = document.createElement('div');
    // Looks like a real scroller: taller content than box, and overflow set.
    Object.defineProperty(panel, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(panel, 'clientHeight', { value: 300, configurable: true });
    panel.style.overflowY = 'auto';
    // Panel occupies the top of the screen.
    panel.getBoundingClientRect = () => ({ top: 0, bottom: 300 }) as DOMRect;
    document.body.appendChild(panel);

    const field = document.createElement('input');
    field.setAttribute('data-invalid', 'true');
    Object.defineProperty(field, 'offsetParent', { value: panel, configurable: true });
    // Below the PANEL's fold, but comfortably inside the viewport — the case
    // a window-based measurement wrongly called visible.
    field.getBoundingClientRect = () => ({ top: 400, bottom: 440 }) as DOMRect;
    const spy = vi.fn();
    field.scrollIntoView = spy;
    panel.appendChild(field);

    scrollToFirstInvalidControl(panel);

    expect(spy).toHaveBeenCalled();
    document.body.removeChild(panel);
  });

  it('finds signal-driven fields marked with data-invalid', () => {
    // The join dialog validates guest name, phone and service with signals,
    // which have no FormControl and therefore no ng-invalid class.
    const host = document.createElement('div');
    const field = document.createElement('input');
    field.setAttribute('data-invalid', 'true');
    Object.defineProperty(field, 'offsetParent', { value: host, configurable: true });
    field.getBoundingClientRect = () => ({ top: 5000, bottom: 5040 }) as DOMRect;
    const spy = vi.fn();
    field.scrollIntoView = spy;
    host.appendChild(field);

    scrollToFirstInvalidControl(host);

    expect(spy).toHaveBeenCalled();
  });

  it('ignores a data-invalid field once it is no longer invalid', () => {
    const host = document.createElement('div');
    const field = document.createElement('input');
    // Bound with [attr.data-invalid]="... ? 'true' : null", so a valid field
    // has the attribute removed entirely rather than set to "false".
    Object.defineProperty(field, 'offsetParent', { value: host, configurable: true });
    const spy = vi.fn();
    field.scrollIntoView = spy;
    host.appendChild(field);

    scrollToFirstInvalidControl(host);

    expect(spy).not.toHaveBeenCalled();
  });
});
