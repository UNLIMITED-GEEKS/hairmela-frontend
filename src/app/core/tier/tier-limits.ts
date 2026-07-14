// Plan limits — mirror the backend exactly (FRONTEND-TIER-HANDOFF §3).
// These power the pre-blocking gates so a user never fires a write the
// backend would 403. The backend is still the source of truth; this is
// honest UI on top of it.
//
// Tier: 0=None (floor, read-only) · 1=Standard · 2=Pro · 3=Scale.
// No free plan — every purchasable tier is paid. During the free trial
// `tier` reads as 3 — branch on isTrialing/status for trial messaging,
// never on the number.

export type Tier = 0 | 1 | 2 | 3;

// The backend returns 1_000_000 as the "unlimited" sentinel; we use Infinity
// internally so `count >= limit` is naturally false for unlimited tiers.
export const UNLIMITED_SENTINEL = 1_000_000;

export const SALON_LIMIT: Record<Tier, number> = {
  0: 0,
  1: 1,
  2: 3,
  3: 6,
};

// Staff limit is inclusive of the owner.
export const STAFF_LIMIT: Record<Tier, number> = {
  0: 0,
  1: Infinity,
  2: Infinity,
  3: Infinity,
};

export const TIER_NAMES: Record<Tier, string> = {
  0: 'No access',
  1: 'Standard',
  2: 'Pro',
  3: 'Scale',
};

// Render the backend's unlimited sentinel as ∞; pass through real numbers.
export function displayLimit(limit: number): string {
  return limit >= UNLIMITED_SENTINEL ? '∞' : String(limit);
}
