import { TestBed } from '@angular/core/testing';
import { Router, Routes } from '@angular/router';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { routes } from '../../app.routes';
import { RouteSegment } from './route-paths';
import { toAuthShellTree, toGuestShellPath } from './shell-url';

describe('shell-url', () => {
  // A real Router, only for parseUrl/serializeUrl — the actual URL grammar,
  // not a hand-rolled split('/'). Asserting against our own string surgery
  // would only prove the test agrees with itself.
  function router(): Router {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    return TestBed.inject(Router);
  }

  describe('toAuthShellTree', () => {
    // The case this whole change exists for: a shared guest link opened by
    // someone who turns out to be signed in.
    it('strips the /g prefix', () => {
      const r = router();
      const out = toAuthShellTree(r.parseUrl('/g/s/kelly-cuts'));
      expect(r.serializeUrl(out!)).toBe('/s/kelly-cuts');
    });

    // Query params are the reason this takes a UrlTree rather than a string.
    // A salon link shared from a category-filtered listing carries ?category=,
    // and dropping it silently un-does the deep link on the far side.
    it('preserves query params and fragment', () => {
      const r = router();
      const out = toAuthShellTree(r.parseUrl('/g/s/kelly-cuts?category=braids#services'));
      expect(r.serializeUrl(out!)).toBe('/s/kelly-cuts?category=braids#services');
    });

    // Deep visit paths matter: /g/s/:slug and /s/:slug load the SAME
    // visitRoutes children, so everything below the prefix must survive.
    it('preserves deep paths below the prefix', () => {
      const r = router();
      const out = toAuthShellTree(r.parseUrl('/g/s/kelly-cuts/q/q1/e/e1/position'));
      expect(r.serializeUrl(out!)).toBe('/s/kelly-cuts/q/q1/e/e1/position');
    });

    // Nothing underneath to carry over — the caller falls back to home.
    it('returns null for a bare /g', () => {
      const r = router();
      expect(toAuthShellTree(r.parseUrl('/g'))).toBeNull();
    });

    // Guards against a positional slice(1): pointed at a non-guest URL this
    // must decline, not silently eat the first segment.
    it('returns null when the path is not guest-prefixed', () => {
      const r = router();
      expect(toAuthShellTree(r.parseUrl('/s/kelly-cuts'))).toBeNull();
      // 'guests' merely starts with 'g' — segment equality, not prefix matching.
      expect(toAuthShellTree(r.parseUrl('/guests/x'))).toBeNull();
    });
  });

  describe('toGuestShellPath', () => {
    it('is the inverse of toAuthShellTree', () => {
      const r = router();
      const authPath = '/s/kelly-cuts';
      const out = toAuthShellTree(r.parseUrl(toGuestShellPath(authPath)));
      expect(r.serializeUrl(out!)).toBe(authPath);
    });
  });

  // ── The invariant the guard rests on ────────────────────────────────────
  //
  // guestShellGuard strips /g and redirects, which is only safe because every
  // guest child has an auth-shell twin at the same path. That claim used to
  // live in a code comment, where nothing enforced it: adding a fifth guest
  // route without a twin would have shipped a redirect to a dead URL.
  describe('route table', () => {
    function childrenOf(path: string): string[] {
      // The auth shell is the '' path WITH children (the public shell is also
      // '' but is matched first); pick by path, then require children.
      const shell = (routes as Routes).find((r) => r.path === path && r.children);
      if (!shell?.children) throw new Error(`no shell found for path '${path}'`);
      return shell.children.map((c) => c.path ?? '');
    }

    it('gives every guest route an auth-shell twin', () => {
      const guest = childrenOf(RouteSegment.G);
      // Sanity: if this ever reads empty the assertion below passes vacuously.
      expect(guest.length).toBeGreaterThan(0);

      const auth = new Set(
        (routes as Routes)
          .filter((r) => r.path === '' && r.children)
          .flatMap((r) => r.children!)
          .map((c) => c.path ?? ''),
      );

      expect(guest.filter((p) => !auth.has(p))).toEqual([]);
    });
  });
});
