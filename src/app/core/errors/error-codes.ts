export const ErrorCodes = {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  GOOGLE_TOKEN_INVALID: 'GOOGLE_TOKEN_INVALID',
  GOOGLE_LINK_REQUIRED: 'GOOGLE_LINK_REQUIRED',
  GOOGLE_PROFILE_INCOMPLETE: 'GOOGLE_PROFILE_INCOMPLETE',
  GOOGLE_AUTH_DISABLED: 'GOOGLE_AUTH_DISABLED',
  APPLE_TOKEN_INVALID: 'APPLE_TOKEN_INVALID',
  APPLE_LINK_REQUIRED: 'APPLE_LINK_REQUIRED',
  APPLE_PROFILE_INCOMPLETE: 'APPLE_PROFILE_INCOMPLETE',
  APPLE_AUTH_DISABLED: 'APPLE_AUTH_DISABLED',
  IDENTITY_CONFLICT: 'IDENTITY_CONFLICT',
  // No Authorization header at all — distinct from TOKEN_INVALID (a bad one).
  // Recoverable: usually a request that raced session restore before the
  // in-memory access token was set, so refresh-and-retry rather than log out.
  TOKEN_MISSING: 'TOKEN_MISSING',

  // ── Application payload encryption ───────────────────────────────────────────
  ENCRYPTION_REQUIRED: 'ENCRYPTION_REQUIRED',
  ENCRYPTION_SESSION_EXPIRED: 'ENCRYPTION_SESSION_EXPIRED',
  ENCRYPTION_INVALID_PAYLOAD: 'ENCRYPTION_INVALID_PAYLOAD',
  ENCRYPTION_VERSION_UNSUPPORTED: 'ENCRYPTION_VERSION_UNSUPPORTED',
  ENCRYPTION_REPLAY_DETECTED: 'ENCRYPTION_REPLAY_DETECTED',

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
  SALON_HAS_BRANCHES: 'SALON_HAS_BRANCHES',
  ALREADY_A_BRANCH: 'ALREADY_A_BRANCH',
  NOT_A_BRANCH: 'NOT_A_BRANCH',
  BRANCH_DIFFERENT_ORG: 'BRANCH_DIFFERENT_ORG',
  INVALID_BRANCH: 'INVALID_BRANCH',

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
  SLOT_IN_PAST: 'SLOT_IN_PAST',
  CANCELLATION_WINDOW_PASSED: 'CANCELLATION_WINDOW_PASSED',
  ALREADY_RESCHEDULED: 'ALREADY_RESCHEDULED',

  // ── Booking fee / receipts ────────────────────────────────────────────────────
  // A salon with enforceBookingFee on takes payment DIRECTLY — HairMela never
  // holds the money. The customer pays, uploads a receipt image, and the
  // backend verifies it before the join or booking is allowed.
  //
  // RECEIPT_NOT_VALID is the one that blocks: the model rejected the image, so
  // there is no proof of payment and the join cannot proceed. RECEIPT_INVALID
  // is recoverable by paying again — receipts expire after 30 minutes and are
  // single-use.
  RECEIPT_REQUIRED: 'RECEIPT_REQUIRED',
  RECEIPT_NOT_VALID: 'RECEIPT_NOT_VALID',
  RECEIPT_INVALID: 'RECEIPT_INVALID',
  RECEIPT_IMAGE_INVALID: 'RECEIPT_IMAGE_INVALID',
  // The salon switched the fee on without saying where to send the money.
  // Also guarded in Salon Settings, which cannot save that combination.
  PAYMENT_DETAILS_REQUIRED: 'PAYMENT_DETAILS_REQUIRED',

  // ── Tiers ─────────────────────────────────────────────────────────────────────
  TIER_REQUIRED: 'TIER_REQUIRED',
  STAFF_LIMIT_REACHED: 'STAFF_LIMIT_REACHED',

  // ── Notifications ─────────────────────────────────────────────────────────────
  NOTIFICATION_NOT_FOUND: 'NOTIFICATION_NOT_FOUND',
  PUSH_SUBSCRIPTION_NOT_FOUND: 'PUSH_SUBSCRIPTION_NOT_FOUND',

  // ── Comments ──────────────────────────────────────────────────────────────────
  COMMENT_FORBIDDEN: 'COMMENT_FORBIDDEN',
  COMMENTS_ENTRY_CLOSED: 'COMMENTS_ENTRY_CLOSED',
  COMMENT_EMPTY: 'COMMENT_EMPTY',
  COMMENT_TOO_LONG: 'COMMENT_TOO_LONG',
  COMMENT_IMAGE_INVALID: 'COMMENT_IMAGE_INVALID',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
