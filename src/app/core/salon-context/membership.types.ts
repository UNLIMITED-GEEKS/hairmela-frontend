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
  // This salon's org — lets the Upgrade CTA build /org/:orgId/billing
  // directly from already-loaded membership, no separate
  // GET /organizations/mine round-trip before it can navigate.
  readonly orgId: string;
  readonly role: SalonRole;
  readonly isStaff: boolean;
  // This user's SalonStaff.id in this salon — null if they have no staff row
  // (e.g. a customer-only membership). Lets staff-scoped nav links (their own
  // photo gallery, services, etc.) resolve synchronously off Membership
  // instead of a separate staff-list fetch just to find their own row.
  readonly staffId: string | null;
  // This staff member's Queue.id in this salon — null if they have no staff
  // row, or have one but no queue exists yet (e.g. right after salon
  // creation, before QueuesListener provisions it). Lets app-wide features
  // (e.g. the queue-sound socket subscription) resolve "my queue" off
  // Membership instead of needing a page that already loaded queue data.
  readonly queueId: string | null;
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
