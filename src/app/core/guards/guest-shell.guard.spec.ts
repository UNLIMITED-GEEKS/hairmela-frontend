import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { TokenStore } from '../auth/token.store';
import { guestShellGuard } from './guest-shell.guard';

describe('guestShellGuard', () => {
  // Only isAuthenticated is consulted; a fake keeps the test off TokenStore's
  // storage and refresh machinery, which is not what is under test here.
  function run(url: string, authenticated: boolean): boolean | UrlTree {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: TokenStore, useValue: { isAuthenticated: signal(authenticated) } },
      ],
    });

    // runInInjectionContext, not a direct call: CanActivateFn uses inject().
    return TestBed.runInInjectionContext(() =>
      guestShellGuard({} as never, { url } as RouterStateSnapshot),
    ) as boolean | UrlTree;
  }

  function serialize(result: boolean | UrlTree): string {
    return TestBed.inject(Router).serializeUrl(result as UrlTree);
  }

  // The bug this guard's redirect was rewritten for: a guest link shared with
  // someone who is signed in used to land them on the home page, losing the
  // salon entirely.
  it('sends a signed-in user to the same page in the auth shell', () => {
    const result = run('/g/s/kelly-cuts', true);
    expect(result).not.toBe(true);
    expect(serialize(result)).toBe('/s/kelly-cuts');
  });

  it('carries query params across the shell switch', () => {
    const result = run('/g/s/kelly-cuts?category=braids', true);
    expect(serialize(result)).toBe('/s/kelly-cuts?category=braids');
  });

  it('keeps deep visit paths intact', () => {
    const result = run('/g/s/kelly-cuts/q/q1/e/e1/position', true);
    expect(serialize(result)).toBe('/s/kelly-cuts/q/q1/e/e1/position');
  });

  // Nothing below /g to preserve — home is the right destination, and was the
  // behaviour before this change too.
  it('falls back to home for a bare /g', () => {
    const result = run('/g', true);
    expect(serialize(result)).toBe('/');
  });

  // Guests and fully anonymous visitors are what the shell is for.
  it('lets an unauthenticated visitor through', () => {
    expect(run('/g/s/kelly-cuts', false)).toBe(true);
  });
});
