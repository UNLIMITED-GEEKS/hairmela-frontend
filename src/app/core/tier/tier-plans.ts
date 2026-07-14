import { Tier } from './tier-limits';

// Single source of truth for plan PRESENTATION (names, taglines, the salon/
// staff/feature lines shown on cards). Limits live in tier-limits.ts; this is
// the human-facing copy that billing, pricing, and the plan-explainer all
// render from — so a copy change happens in one place, never drifts across
// surfaces. Tier 0 (floor) is never a purchase target, so it has no card.
export interface PlanCard {
  readonly tier: Tier;
  readonly name: string;
  readonly tagline: string;
  readonly salons: string;
  readonly staff: string;
  readonly price: number;
  readonly features: readonly string[];
}

/** ₦3,000/month — thousands-separated, matches every price display. */
export function formatPlanPrice(price: number): string {
  return `₦${price.toLocaleString('en-NG')}/month`;
}

export const PLAN_CARDS: readonly PlanCard[] = [
  {
    tier: 1,
    name: 'Free',
    tagline: 'For a single salon getting started.',
    salons: '1 salon',
    staff: '1 staff (owner only)',
    price: 0,
    features: ['Walk-in queue'],
  },
  {
    tier: 2,
    name: 'Pro',
    price: 2900,
    tagline: 'For growing salons with a team.',
    salons: 'Up to 3 salons',
    staff: 'Unlimited staff',
    features: ['Walk-in queue', 'Appointments (coming soon)', 'Analytics'],
  },
  {
    tier: 3,
    name: 'Scale',
    price: 9900,
    tagline: 'For multi-location businesses.',
    salons: 'Unlimited salons',
    staff: 'Unlimited staff',
    features: ['Everything in Pro', 'Priority support'],
  },
];
