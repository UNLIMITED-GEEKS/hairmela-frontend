import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { DeepLinkService } from './deep-link.service';
import { AppPlatformService } from './app-platform.service';

// Covers the URL → in-app path mapping only. init() is not exercised here: it
// dynamically imports @capacitor/app, which does not exist off-device.
//
// WHY THIS EXISTS: custom-scheme URLs parse differently from https ones and the
// difference is invisible. `new URL('hairmela://org/x/billing')` puts `org` in
// HOST, not pathname — so reading pathname alone silently drops a segment and
// routes to a path that does not exist, landing the user on NotFound after
// paying. That is the payment return path, so it fails at the worst moment.
describe('DeepLinkService — URL to in-app path', () => {
  let service: DeepLinkService;

  // _toInAppPath is private; exercised through the instance rather than
  // widening the API just for a test.
  function toPath(url: string): string | null {
    return (service as unknown as { _toInAppPath(u: string): string | null })._toInAppPath(url);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DeepLinkService,
        { provide: Router, useValue: { events: { pipe: () => ({ subscribe: () => undefined }) } } },
        { provide: AppPlatformService, useValue: { isNative: true } },
      ],
    });
    service = TestBed.inject(DeepLinkService);
  });

  it('keeps every segment of a custom-scheme payment callback', () => {
    expect(toPath('hairmela://org/abc123/billing/payment/callback?status=successful&tx_ref=T1')).toBe(
      '/org/abc123/billing/payment/callback?status=successful&tx_ref=T1',
    );
  });

  it('accepts the empty-authority spelling of the same URL', () => {
    expect(toPath('hairmela:///org/abc123/billing/payment/callback?status=successful')).toBe(
      '/org/abc123/billing/payment/callback?status=successful',
    );
  });

  it('still maps an https App Link by pathname', () => {
    expect(toPath('https://hairmela.com/s/fade-house?category=braids')).toBe(
      '/s/fade-house?category=braids',
    );
  });

  it('ignores the host on https links', () => {
    // Several claimed hosts serve the same routes; only the path matters.
    expect(toPath('https://dev-hairmela.vercel.app/g/queues')).toBe('/g/queues');
  });

  it('returns null for a bare domain, which carries no destination', () => {
    expect(toPath('https://hairmela.com/')).toBeNull();
    expect(toPath('hairmela://')).toBeNull();
  });

  it('returns null for an unparseable url rather than throwing', () => {
    expect(toPath('not a url')).toBeNull();
  });
});
