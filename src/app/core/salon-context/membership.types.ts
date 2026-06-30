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
