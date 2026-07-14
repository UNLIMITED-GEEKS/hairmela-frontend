export const SalonRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  STAFF: 'STAFF',
  CUSTOMER: 'CUSTOMER',
} as const;

export type SalonRole = (typeof SalonRole)[keyof typeof SalonRole];

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';

export interface Membership {
  readonly salonId: string;
  readonly role: SalonRole;
  readonly isStaff: boolean;
  // This user's SalonStaff.id in this salon — null if they have no staff row
  // (e.g. a customer-only membership). Lets staff-scoped nav links (their own
  // photo gallery, services, etc.) resolve synchronously off Membership
  // instead of a separate staff-list fetch just to find their own row.
  readonly staffId: string | null;
  readonly canManageSalon: boolean;
  readonly canManageStaff: boolean;
  readonly tier: number;
  readonly isFrozen: boolean;
  // ── Tier / subscription (from GET /salons/:salonId/me) ──
  readonly staffFrozen: boolean;
  readonly status: SubscriptionStatus;
  readonly isTrialing: boolean;
  readonly trialEndsAt: string | null;
  readonly daysLeft: number | null;
}
