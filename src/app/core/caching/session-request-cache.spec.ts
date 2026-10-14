import { Subject, of, take } from 'rxjs';
import { SessionRequestCache } from './session-request-cache';

describe('SessionRequestCache', () => {
  it('bounds cached results and retains recently visited keys', () => {
    const cache = new SessionRequestCache<string[]>();
    for (let index = 0; index < 40; index++) cache.set(String(index), [String(index)]);
    cache.get('0', () => of(['0'])).subscribe();
    cache.set('40', ['40']);
    expect(cache.peek('0')).toEqual(['0']);
    expect(cache.peek('1')).toBeUndefined();
    expect([...cache.entries()]).toHaveLength(40);
  });

  it('reads the current session when a previously created observable is subscribed', () => {
    const cache = new SessionRequestCache<string[]>();
    cache.set('customers', ['old account']);
    const read = cache.get('customers', () => of(['new account']));
    cache.clear();
    const results: string[][] = [];
    read.subscribe((result) => results.push(result));
    expect(results).toEqual([['new account']]);
  });

  it('does not start or retain a request when only the cached value is consumed', () => {
    const cache = new SessionRequestCache<string[]>();
    cache.set('customers', ['cached']);
    const abandonedFetch = vi.fn(() => of(['abandoned']));
    cache.get('customers', abandonedFetch).pipe(take(1)).subscribe();
    expect(abandonedFetch).not.toHaveBeenCalled();
    const results: string[][] = [];
    cache.get('customers', () => of(['fresh'])).subscribe((result) => results.push(result));
    expect(results).toEqual([['cached'], ['fresh']]);
  });
  it('replays a cached empty result immediately and shares the background request', () => {
    const cache = new SessionRequestCache<string[]>();
    cache.set('customers', []);
    const response = new Subject<string[]>();
    const fetch = vi.fn(() => response);
    const first: string[][] = [];
    const second: string[][] = [];
    cache.get('customers', fetch).subscribe((value) => first.push(value));
    cache.get('customers', fetch).subscribe((value) => second.push(value));
    expect(first).toEqual([[]]);
    expect(second).toEqual([[]]);
    expect(fetch).toHaveBeenCalledTimes(1);
    response.next(['new customer']);
    response.complete();
    expect(first).toEqual([[], ['new customer']]);
    expect(second).toEqual(first);
  });

  it('keeps stale data when a refresh fails and retries on the next visit', () => {
    const cache = new SessionRequestCache<string[]>();
    cache.set('customers', ['cached']);
    const failed = new Subject<string[]>();
    cache.get('customers', () => failed).subscribe({ error: () => {} });
    failed.error(new Error('offline'));
    expect(cache.peek('customers')).toEqual(['cached']);
    const retry = new Subject<string[]>();
    const fetch = vi.fn(() => retry);
    cache.get('customers', fetch).subscribe();
    expect(fetch).toHaveBeenCalledTimes(1);
    retry.complete();
  });

  it('keeps contexts separate and prevents late responses from restoring logged-out data', () => {
    const cache = new SessionRequestCache<string[]>();
    const old = new Subject<string[]>();
    cache.get('salon-1', () => old).subscribe();
    cache.set('salon-2', ['other salon']);
    cache.clear();
    const fresh = new Subject<string[]>();
    cache.get('salon-1', () => fresh).subscribe();
    old.next(['old account']);
    old.complete();
    expect(cache.peek('salon-1')).toBeUndefined();
    expect(cache.peek('salon-2')).toBeUndefined();
    fresh.next(['new account']);
    fresh.complete();
    expect(cache.peek('salon-1')).toEqual(['new account']);
  });
});
