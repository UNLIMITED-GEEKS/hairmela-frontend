import { Component, computed, signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ListingScrollMemoryDirective } from './listing-scroll-memory.directive';
import { ListingScrollStore } from '../../core/scroll/listing-scroll.store';

// A real strip with real cards. The directive sits on the scrolling element
// itself, which is what the call sites do.
@Component({
  selector: 'app-host',
  imports: [ListingScrollMemoryDirective],
  template: `
    <div
      class="strip"
      appListingScrollMemory
      [surface]="surface()"
      [items]="cards()">
      @for (id of items(); track id) {
        <div>{{ id }}</div>
      }
    </div>
  `,
})
class HostComponent {
  readonly items = signal<string[]>([]);
  readonly cards = computed(() => this.items().map((id) => ({ id })));
  readonly surface = signal<'search' | 'landing'>('search');
}

describe('ListingScrollMemoryDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let store: ListingScrollStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    store = TestBed.inject(ListingScrollStore);
  });

  function strip(): HTMLElement {
    return fixture.nativeElement.querySelector('.strip') as HTMLElement;
  }

  it('restores the offset the user left the strip at', async () => {
    store.save('search', 640);
    host.items.set(['s1', 's2', 's3']);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(strip().scrollLeft).toBe(640);
  });

  it('saves the current offset when a card is tapped', async () => {
    host.items.set(['s1', 's2']);
    fixture.detectChanges();
    await fixture.whenStable();

    strip().scrollLeft = 480;
    strip().dispatchEvent(new Event('pointerdown'));

    expect(store.take('search')).toBe(480);
  });

  it('applies a saved offset only once', async () => {
    store.save('search', 300);
    host.items.set(['s1', 's2']);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(strip().scrollLeft).toBe(300);

    // A later list change (a refetch, a cache read, a filter edit) must not
    // re-apply it — the user may have scrolled elsewhere since.
    strip().scrollLeft = 0;
    host.items.set(['s1', 's2', 's3']);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(strip().scrollLeft).toBe(0);
  });

  it('never writes to a strip the user has taken hold of', async () => {
    store.save('search', 700);
    host.items.set(['s1', 's2']);

    // The user grabs the strip before the restore can run. Writing after this
    // point lands mid-gesture and is felt as the list snapping.
    strip().dispatchEvent(new Event('pointerdown'));

    fixture.detectChanges();
    await fixture.whenStable();

    expect(strip().scrollLeft).toBe(0);
  });

  it('leaves an already-positioned strip alone', async () => {
    store.save('search', 500);
    host.items.set(['s1', 's2']);
    // Something else positioned it first; overwriting that would be exactly
    // the kind of surprise this must not cause.
    strip().scrollLeft = 120;

    fixture.detectChanges();
    await fixture.whenStable();

    expect(strip().scrollLeft).toBe(120);
  });

  it('ignores an offset saved by a different surface', async () => {
    store.save('landing', 800);
    host.items.set(['s1', 's2']);
    fixture.detectChanges();
    await fixture.whenStable();

    // Two strips must not inherit each other's position.
    expect(strip().scrollLeft).toBe(0);
  });

  it('waits for the list to render before applying', async () => {
    store.save('search', 250);
    // No cards yet — the strip has no width to scroll within, and a write
    // would be silently clamped to 0.
    host.items.set([]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(strip().scrollLeft).toBe(0);

    host.items.set(['s1', 's2']);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(strip().scrollLeft).toBe(250);
  });
});

// Search on mobile splits its results across two rows that scroll
// independently. They are separate strips with separate keys, and the risk
// worth pinning is that one inherits the other's offset.
@Component({
  selector: 'app-split-host',
  imports: [ListingScrollMemoryDirective],
  template: `
    <div class="top" appListingScrollMemory surface="search-top" [items]="top()">
      @for (id of top(); track id.id) {
        <div>{{ id.id }}</div>
      }
    </div>
    <div class="bottom" appListingScrollMemory surface="search-bottom" [items]="bottom()">
      @for (id of bottom(); track id.id) {
        <div>{{ id.id }}</div>
      }
    </div>
  `,
})
class SplitHostComponent {
  readonly top = signal<{ id: string }[]>([]);
  readonly bottom = signal<{ id: string }[]>([]);
}

describe('ListingScrollMemoryDirective — search split rows', () => {
  let fixture: ComponentFixture<SplitHostComponent>;
  let hostCmp: SplitHostComponent;
  let store: ListingScrollStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SplitHostComponent] });
    fixture = TestBed.createComponent(SplitHostComponent);
    hostCmp = fixture.componentInstance;
    store = TestBed.inject(ListingScrollStore);
  });

  function topStrip(): HTMLElement {
    return fixture.nativeElement.querySelector('.top') as HTMLElement;
  }
  function bottomStrip(): HTMLElement {
    return fixture.nativeElement.querySelector('.bottom') as HTMLElement;
  }

  it('restores each row to its own offset', async () => {
    store.save('search-top', 300);
    store.save('search-bottom', 700);
    hostCmp.top.set([{ id: 'a' }, { id: 'b' }]);
    hostCmp.bottom.set([{ id: 'c' }, { id: 'd' }]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(topStrip().scrollLeft).toBe(300);
    expect(bottomStrip().scrollLeft).toBe(700);
  });

  it('does not let one row inherit the other rows offset', async () => {
    // Only the top row has a saved position.
    store.save('search-top', 450);
    hostCmp.top.set([{ id: 'a' }, { id: 'b' }]);
    hostCmp.bottom.set([{ id: 'c' }, { id: 'd' }]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(topStrip().scrollLeft).toBe(450);
    expect(bottomStrip().scrollLeft).toBe(0);
  });

  it('saves each row independently when tapped', async () => {
    hostCmp.top.set([{ id: 'a' }]);
    hostCmp.bottom.set([{ id: 'c' }]);
    fixture.detectChanges();
    await fixture.whenStable();

    topStrip().scrollLeft = 120;
    topStrip().dispatchEvent(new Event('pointerdown'));
    bottomStrip().scrollLeft = 640;
    bottomStrip().dispatchEvent(new Event('pointerdown'));

    expect(store.take('search-top')).toBe(120);
    expect(store.take('search-bottom')).toBe(640);
  });
});

describe('ListingScrollStore', () => {
  let store: ListingScrollStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(ListingScrollStore);
  });

  it('take() clears the offset so it cannot be applied twice', () => {
    store.save('search', 400);
    expect(store.take('search')).toBe(400);
    expect(store.take('search')).toBeNull();
  });

  it('keeps surfaces independent', () => {
    store.save('search', 100);
    store.save('landing', 200);
    expect(store.take('search')).toBe(100);
    expect(store.take('landing')).toBe(200);
  });

  it('saving 0 forgets the surface rather than storing it', () => {
    store.save('search', 300);
    // Back at the start is the default; storing it would make a later restore
    // a no-op that looks like a failure.
    store.save('search', 0);
    expect(store.take('search')).toBeNull();
  });

  it('clear() forgets everything', () => {
    store.save('search', 100);
    store.clear();
    expect(store.take('search')).toBeNull();
  });
});
