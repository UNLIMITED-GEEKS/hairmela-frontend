export const ErrorCodes = {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',

  // ── Users ─────────────────────────────────────────────────────────────────────
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',

  // ── Organizations ─────────────────────────────────────────────────────────────
  ORG_NOT_FOUND: 'ORG_NOT_FOUND',

  // ── Salons ────────────────────────────────────────────────────────────────────
  SALON_NOT_FOUND: 'SALON_NOT_FOUND',
  SALON_SLUG_TAKEN: 'SALON_SLUG_TAKEN',
  SALON_LIMIT_REACHED: 'SALON_LIMIT_REACHED',
  SALON_FROZEN: 'SALON_FROZEN',

  // ── Staff ─────────────────────────────────────────────────────────────────────
  STAFF_NOT_FOUND: 'STAFF_NOT_FOUND',
  STAFF_ALREADY_INVITED: 'STAFF_ALREADY_INVITED',
  CANNOT_REMOVE_OWNER: 'CANNOT_REMOVE_OWNER',
  INVITE_NOT_FOUND: 'INVITE_NOT_FOUND',

  // ── Services ──────────────────────────────────────────────────────────────────
  SERVICE_NOT_FOUND: 'SERVICE_NOT_FOUND',
  SERVICE_NAME_TAKEN: 'SERVICE_NAME_TAKEN',

  // ── Queues ────────────────────────────────────────────────────────────────────
  QUEUE_NOT_FOUND: 'QUEUE_NOT_FOUND',
  QUEUE_NOT_OPEN: 'QUEUE_NOT_OPEN',
  QUEUE_ALREADY_CLOSED: 'QUEUE_ALREADY_CLOSED',
  ENTRY_NOT_FOUND: 'ENTRY_NOT_FOUND',
  ENTRY_NOT_WAITING: 'ENTRY_NOT_WAITING',
  ENTRY_ALREADY_SERVING: 'ENTRY_ALREADY_SERVING',
  MEMBER_NOT_FOUND: 'MEMBER_NOT_FOUND',
  MEMBER_NOT_SERVING: 'MEMBER_NOT_SERVING',
  PARTY_TOO_LARGE: 'PARTY_TOO_LARGE',

  // ── Appointments ──────────────────────────────────────────────────────────────
  SLOT_ALREADY_BOOKED: 'SLOT_ALREADY_BOOKED',
  SLOT_NOT_AVAILABLE: 'SLOT_NOT_AVAILABLE',
  CANCELLATION_WINDOW_PASSED: 'CANCELLATION_WINDOW_PASSED',

  // ── Tiers ─────────────────────────────────────────────────────────────────────
  TIER_REQUIRED: 'TIER_REQUIRED',

  // ── Notifications ─────────────────────────────────────────────────────────────
  NOTIFICATION_NOT_FOUND: 'NOTIFICATION_NOT_FOUND',
  PUSH_SUBSCRIPTION_NOT_FOUND: 'PUSH_SUBSCRIPTION_NOT_FOUND',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
