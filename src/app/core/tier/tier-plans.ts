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
  readonly features: readonly string[];
}

export const PLAN_CARDS: readonly PlanCard[] = [
  {
    tier: 1,
    name: 'Free',
    tagline: 'For a single barber getting started.',
    salons: '1 salon',
    staff: '1 staff (owner only)',
    features: ['Walk-in queue'],
  },
  {
    tier: 2,
    name: 'Pro',
    tagline: 'For growing salons with a team.',
    salons: 'Up to 3 salons',
    staff: 'Unlimited staff',
    features: ['Walk-in queue', 'Appointments', 'Analytics'],
  },
  {
    tier: 3,
    name: 'Scale',
    tagline: 'For multi-location businesses.',
    salons: 'Unlimited salons',
    staff: 'Unlimited staff',
    features: ['Everything in Pro', 'Priority support'],
  },
];
