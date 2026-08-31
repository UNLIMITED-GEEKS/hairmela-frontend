import { PRIMARY_OUTLET, UrlSegment, UrlTree } from '@angular/router';
import { RouteSegment } from './route-paths';

/**
 * The guest shell (`/g/...`) and the auth shell (`/...`) mirror each other:
 * every guest child in app.routes.ts has an auth-shell twin at the same path
 * minus the `/g` prefix. Two guards depend on that relationship in opposite
 * directions — authGuard ADDS the prefix for a visitor with no account,
 * guestShellGuard STRIPS it for a visitor who turns out to be signed in.
 *
 * Both go through here so the mapping is defined once. Encoding it twice, as
 * two independent string manipulations, is how the two drift apart.
 *
 * The twin-route invariant is not merely documented — shell-url.spec.ts walks
 * the real route table and fails if a guest route is ever added without one.
 */

/** `/s/kelly-cuts` → `/g/s/kelly-cuts`. Input must be an absolute path. */
export function toGuestShellPath(authPath: string): string {
  return `/${RouteSegment.G}${authPath}`;
}

/**
 * `/g/s/kelly-cuts?category=braids` → `/s/kelly-cuts?category=braids`.
 *
 * Takes and returns a UrlTree rather than a string so query params and the
 * fragment ride along untouched — a shared link may carry either, and
 * rebuilding a path by hand is exactly where they get dropped.
 *
 * Returns null when there is nothing to strip: a bare `/g`, or a tree that
 * does not start with the guest prefix at all. Callers decide what that means
 * for them — the guard sends those to the home page.
 *
 * TAKES OWNERSHIP of `tree` and mutates it in place. UrlSegmentGroup exposes
 * no public copy constructor, and hand-rebuilding the group graph is more
 * fragile across Angular versions than this one assignment. Pass a tree you
 * just created (router.parseUrl) and hold no other reference to it.
 */
export function toAuthShellTree(tree: UrlTree): UrlTree | null {
  const primary = tree.root.children[PRIMARY_OUTLET];
  const segments: UrlSegment[] = primary?.segments ?? [];

  // Checked, not assumed positional: slicing blindly would eat the first
  // segment of any URL this is ever pointed at that is not guest-prefixed.
  if (segments.length <= 1 || segments[0].path !== RouteSegment.G) return null;

  primary.segments = segments.slice(1);
  return tree;
}
