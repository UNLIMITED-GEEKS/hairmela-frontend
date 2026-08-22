import { TestBed, ComponentFixture } from '@angular/core/testing';
import { vi } from 'vitest';
import { CategoryPillsComponent } from './category-pills.component';
import { CategoryResponseDto } from '../../../api/models/category-response-dto';

// The behaviour under test is scroll restoration: a category far along the row
// (Nails) is off-screen at rest, so returning from a salon with that filter
// still applied left the selected pill invisible — the row looked unfiltered.
//
// jsdom reports every layout measurement as 0, so the DOM cannot decide
// visibility on its own. Each test stubs offsetLeft/offsetWidth/clientWidth to
// describe a specific layout, which is also what makes the assertions explicit
// about the geometry they depend on.
describe('CategoryPillsComponent', () => {
  const CATEGORIES = [
    { id: '1', name: 'Barbing', slug: 'barbing' },
    { id: '2', name: 'Braids', slug: 'braids' },
    { id: '3', name: 'Nails', slug: 'nails' },
  ] as CategoryResponseDto[];

  let fixture: ComponentFixture<CategoryPillsComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CategoryPillsComponent] });
    fixture = TestBed.createComponent(CategoryPillsComponent);
  });

  /**
   * Renders with a stubbed layout: container 300px wide, each pill 100px, laid
   * out left to right.
   *
   * Order matters. The pills must exist (first detectChanges) and be measured
   * BEFORE the effect's afterNextRender callback runs — hence a second
   * detectChanges after the measurements are in place. Stubbing afterwards
   * silently produces a no-op scroll and a passing-looking test that proves
   * nothing.
   */
  function renderWithLayout(
    selected: string,
    scrollLeft = 0,
  ): { scrollTo: ReturnType<typeof vi.fn> } {
    const scrollTo = vi.fn();

    // Stub the container BEFORE the first detectChanges: afterNextRender fires
    // once, after that first render, and does not re-run on later passes.
    // Measuring afterwards would leave the assertion checking a callback that
    // had already run against an unstubbed (all-zero) jsdom layout.
    const container = fixture.nativeElement.querySelector('div') as HTMLElement;
    Object.defineProperty(container, 'clientWidth', { value: 300, configurable: true });
    Object.defineProperty(container, 'scrollLeft', { value: scrollLeft, configurable: true });
    container.scrollTo = scrollTo as unknown as typeof container.scrollTo;

    // querySelector is stubbed so the pills report a layout the moment they
    // exist — they are created during detectChanges, so they cannot be
    // measured up front the way the container can.
    const realQuery = container.querySelector.bind(container);
    container.querySelector = ((sel: string) => {
      const el = realQuery(sel) as HTMLElement | null;
      if (el) {
        const buttons = Array.from(container.querySelectorAll('button')) as HTMLElement[];
        const index = buttons.indexOf(el);
        Object.defineProperty(el, 'offsetLeft', { value: index * 100, configurable: true });
        Object.defineProperty(el, 'offsetWidth', { value: 100, configurable: true });
      }
      return el;
    }) as typeof container.querySelector;

    fixture.componentRef.setInput('categories', CATEGORIES);
    fixture.componentRef.setInput('selected', selected);
    fixture.detectChanges();
    return { scrollTo };
  }

  function render(selected: string): void {
    fixture.componentRef.setInput('categories', CATEGORIES);
    fixture.componentRef.setInput('selected', selected);
    fixture.detectChanges();
  }

  it('marks only the selected pill, so the scroll target is unambiguous', () => {
    render('nails');
    const marked = fixture.nativeElement.querySelectorAll('[data-selected="true"]');
    expect(marked.length).toBe(1);
    expect(marked[0].textContent.trim()).toBe('Nails');
  });

  it('marks "All" when nothing is selected', () => {
    render('');
    const marked = fixture.nativeElement.querySelectorAll('[data-selected="true"]');
    expect(marked.length).toBe(1);
    expect(marked[0].textContent.trim()).toBe('All');
  });

  it('scrolls an off-screen selection into view — the bug this fixes', async () => {
    // Nails is the 4th pill: offsetLeft 300, i.e. just past a 300px viewport
    // scrolled to 0. Invisible without intervention.
    const { scrollTo } = renderWithLayout('nails', 0);
    await fixture.whenStable();

    expect(scrollTo).toHaveBeenCalledTimes(1);
    // Centred: 300 - 300/2 + 100/2 = 200
    expect(scrollTo).toHaveBeenCalledWith({ left: 200, behavior: 'auto' });
  });

  it('leaves the row alone when the selection is already visible', async () => {
    // Barbing is the 2nd pill: offsetLeft 100, fully inside the 0-300 viewport.
    // This is the TAP case — scrolling here would yank the row under a user
    // who just tapped a pill they could already see.
    const { scrollTo } = renderWithLayout('barbing', 0);
    await fixture.whenStable();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('never scrolls to a negative offset', async () => {
    // Scrolled right, so Barbing (offsetLeft 100) is off-screen to the LEFT.
    // Centring it computes 100 - 150 + 50 = 0, and anything more extreme would
    // go negative — clamped, since a negative scrollLeft is meaningless.
    const { scrollTo } = renderWithLayout('barbing', 400);
    await fixture.whenStable();

    expect(scrollTo).toHaveBeenCalledTimes(1);
    const [{ left }] = scrollTo.mock.calls[0] as [{ left: number }];
    expect(left).toBeGreaterThanOrEqual(0);
  });

  it('does nothing before categories have loaded', async () => {
    // The restore case: the filter is applied before the pills arrive, so
    // there is nothing to scroll to yet. Must not throw, must not scroll.
    fixture.componentRef.setInput('categories', []);
    fixture.componentRef.setInput('selected', 'nails');
    fixture.detectChanges();

    const container = fixture.nativeElement.querySelector('div') as HTMLElement;
    const scrollTo = vi.fn();
    container.scrollTo = scrollTo as unknown as typeof container.scrollTo;
    await fixture.whenStable();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('emits the slug when a pill is tapped', () => {
    render('');
    const emitted: string[] = [];
    fixture.componentInstance.select.subscribe((slug) => emitted.push(slug));

    const buttons = fixture.nativeElement.querySelectorAll('button');
    buttons[3].click(); // Nails
    expect(emitted).toEqual(['nails']);
  });
});
