export const SalonRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  STAFF: 'STAFF',
  CUSTOMER: 'CUSTOMER',
} as const;

export type SalonRole = (typeof SalonRole)[keyof typeof SalonRole];

export interface Membership {
  readonly salonId: string;
  readonly role: SalonRole;
  readonly isStaff: boolean;
  readonly canManageSalon: boolean;
  readonly canManageStaff: boolean;
  readonly tier: number;
  readonly isFrozen: boolean;
}
