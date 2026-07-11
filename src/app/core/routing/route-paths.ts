// Central source of truth for route param names and path segments — used by
// both route definitions (*.routes.ts) and navigation call sites, so the two
// can never drift apart. Segments are raw strings for use in `path:` config;
// the RoutePath builders return full segment arrays for router.navigate/routerLink.

export const RouteParam = {
  SALON_ID: 'salonId',
  STAFF_ID: 'staffId',
  SERVICE_ID: 'serviceId',
  ORG_ID: 'orgId',
  QUEUE_ID: 'queueId',
  ENTRY_ID: 'entryId',
  SLUG: 'slug',
} as const;

export const RouteQueryParam = {
  TOKEN: 'token',
  RETURN_URL: 'returnUrl',
  REGISTERED: 'registered',
  RESET: 'reset',
  REFERENCE: 'reference',
  SALON: 'salon',
  SERVICE_ID: 'serviceId',
  // Flutterwave checkout redirect params (payment callback route).
  STATUS: 'status',
  TX_REF: 'tx_ref',
  TRANSACTION_ID: 'transaction_id',
} as const;

// Raw path segments — referenced by *.routes.ts `path:` definitions.
export const RouteSegment = {
  DASHBOARD: 'dashboard',
  ACCOUNT: 'account',
  EDIT_PROFILE: 'edit-profile',
  NOTIFICATIONS: 'notifications',
  QUEUES: 'queues',
  FAVORITES: 'favorites',
  SALONS: 'salons',
  NEW: 'new',
  ORG: 'org',
  CONSOLE: 'console',
  QUEUE: 'queue',

  SETTINGS: 'settings',
  SLUG_EDIT: 'slug',
  SHARE: 'share',
  DELETE: 'delete',
  LEAVE: 'leave',
  ANALYTICS: 'analytics',
  MEDIA: 'media',
  CLOSURES: 'closures',
  SERVICES: 'services',
  STAFF: 'staff',
  INVITE: 'invite',
  SCHEDULES: 'schedules',
  EDIT: 'edit',
  TRANSFER_OWNERSHIP: 'transfer-ownership',

  PLAN: 'plan',
  BILLING: 'billing',
  PAYMENT: 'payment',
  CALLBACK: 'callback',

  S: 's',
  G: 'g',
  Q: 'q',
  E: 'e',
  JOINING: 'joining',
  POSITION: 'position',

  LOGIN: 'login',
  REGISTER: 'register',
  FORGOT_PASSWORD: 'forgot-password',
  VERIFY_EMAIL: 'verify-email',
  AUTH_VERIFY_EMAIL: 'auth/verify-email',
  AUTH_RESET_PASSWORD: 'auth/reset-password',
  ACCEPT_INVITE: 'staff/accept-invite',
  PRIVACY: 'privacy',
  PRICING: 'pricing',
  HOW_TO_INSTALL: 'how-to-install',
  TERMS: 'terms',
  CONTACT: 'contact',
  ABOUT: 'about',
} as const;

// Full-path builders — used by router.navigate([...]) / [routerLink]="[...]".
export const RoutePath = {
  root: () => ['/'],
  dashboard: () => ['/dashboard'],
  account: () => ['/account'],
  editProfile: () => ['/account', RouteSegment.EDIT_PROFILE],
  queues: () => ['/queues'],
  favorites: () => ['/favorites'],
  login: () => ['/login'],
  register: () => ['/register'],
  forgotPassword: () => ['/forgot-password'],
  privacy: () => ['/privacy'],
  pricing: () => ['/pricing'],
  about: () => ['/about'],
  howToInstall: () => ['/how-to-install'],
  terms: () => ['/terms'],
  contact: () => ['/contact'],

  newSalon: () => ['/salons', RouteSegment.NEW],
  salon: (salonId: string) => ['/salons', salonId],
  salonSettings: (salonId: string) => ['/salons', salonId, RouteSegment.SETTINGS],
  salonSlugEdit: (salonId: string) => ['/salons', salonId, RouteSegment.SLUG_EDIT],
  salonShare: (salonId: string) => ['/salons', salonId, RouteSegment.SHARE],
  salonDelete: (salonId: string) => ['/salons', salonId, RouteSegment.DELETE],
  salonLeave: (salonId: string) => ['/salons', salonId, RouteSegment.LEAVE],
  salonAnalytics: (salonId: string) => ['/salons', salonId, RouteSegment.ANALYTICS],
  salonMedia: (salonId: string) => ['/salons', salonId, RouteSegment.MEDIA],
  salonClosures: (salonId: string) => ['/salons', salonId, RouteSegment.CLOSURES],
  salonServices: (salonId: string) => ['/salons', salonId, RouteSegment.SERVICES],
  salonServiceNew: (salonId: string) => ['/salons', salonId, RouteSegment.SERVICES, RouteSegment.NEW],
  salonServiceEdit: (salonId: string, serviceId: string) => [
    '/salons', salonId, RouteSegment.SERVICES, serviceId, RouteSegment.EDIT,
  ],
  salonStaff: (salonId: string) => ['/salons', salonId, RouteSegment.STAFF],
  salonStaffInvite: (salonId: string) => ['/salons', salonId, RouteSegment.STAFF, RouteSegment.INVITE],
  salonStaffTransferOwnership: (salonId: string) => [
    '/salons', salonId, RouteSegment.STAFF, RouteSegment.TRANSFER_OWNERSHIP,
  ],
  salonStaffDetail: (salonId: string, staffId: string) => ['/salons', salonId, RouteSegment.STAFF, staffId],
  salonStaffMedia: (salonId: string, staffId: string) => [
    '/salons', salonId, RouteSegment.STAFF, staffId, RouteSegment.MEDIA,
  ],
  salonStaffServices: (salonId: string, staffId: string) => [
    '/salons', salonId, RouteSegment.STAFF, staffId, RouteSegment.SERVICES,
  ],
  salonStaffSchedules: (salonId: string, staffId: string) => [
    '/salons', salonId, RouteSegment.STAFF, staffId, RouteSegment.SCHEDULES,
  ],
  salonStaffClosures: (salonId: string, staffId: string) => [
    '/salons', salonId, RouteSegment.STAFF, staffId, RouteSegment.CLOSURES,
  ],
  salonQueueConsole: (salonId: string, queueId: string) => [
    '/salons', salonId, RouteSegment.QUEUES, queueId, RouteSegment.CONSOLE,
  ],
  salonQueueConsoleQueue: (salonId: string, queueId: string) => [
    '/salons', salonId, RouteSegment.QUEUES, queueId, RouteSegment.CONSOLE, RouteSegment.QUEUE,
  ],

  org: (orgId: string) => ['/org', orgId],
  orgSettings: (orgId: string) => ['/org', orgId, RouteSegment.SETTINGS],
  orgPlan: (orgId: string) => ['/org', orgId, RouteSegment.PLAN],
  orgBilling: (orgId: string) => ['/org', orgId, RouteSegment.BILLING],
  orgBillingPaymentCallback: (orgId: string) => [
    '/org', orgId, RouteSegment.BILLING, RouteSegment.PAYMENT, RouteSegment.CALLBACK,
  ],

  // Visit flow — `base` is '' (auth shell) or '/g' (guest shell), matching shellPrefix.
  visitSalon: (base: string, slug: string) => [`${base}/s`, slug],
  visitQueue: (base: string, slug: string, queueId: string) => [`${base}/s`, slug, RouteSegment.Q, queueId],
  visitJoining: (base: string, slug: string, queueId: string) => [
    `${base}/s`, slug, RouteSegment.Q, queueId, RouteSegment.JOINING,
  ],
  visitPosition: (base: string, slug: string, queueId: string, entryId: string) => [
    `${base}/s`, slug, RouteSegment.Q, queueId, RouteSegment.E, entryId, RouteSegment.POSITION,
  ],
  guestQueues: () => ['/g/queues'],
} as const;
