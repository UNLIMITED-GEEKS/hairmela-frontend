# HairMela Frontend Plan (Angular)

> Companion to the HairMela Backend Plan. The backend is fully built (Phases 1–9 ✅), so frontend phasing is ordered by frontend dependency, not backend availability. All API paths in this document are served under the backend's **/v1** prefix (omitted in tables for readability, exactly as in the backend plan).

## Scope & Current State

The core is the **walk-in queue product**: salon owners set up their salon, staff, services, and hours; customers sign in (or browse as a guest), join a barber's line, and watch their position live. **The MVP (Phases 1–7) shipped, plus four post-MVP feature waves (Phases 8–11): tier/billing, web push, salon discovery + favourites, and the marketing/legal site.** See the Build Status table for the phase breakdown. Booking/appointments and full anonymous (no-guest-token) public access + analytics remain the only large post-MVP groups still open.

**Guest access is live.** Unauthenticated visitors can visit `/g/s/:slug`, choose a barber, and join the queue without an account. The backend issues a short-lived guest JWT stored in `localStorage` under `hairmela_guest`. Guests can track their position and add party members. When they register, the guest token is cleared and their entry persists on the backend.

**Email verification is a soft nudge, not a gate.** The backend's `@RequiresVerifiedEmail` decorator is still not applied to any route, so nothing is *gated* on `emailVerified` and `EMAIL_NOT_VERIFIED` is never handled. But a dismissible `VerifyEmailBannerComponent` (shown on the account page only) encourages verification with a resend action, and the `/verify-email` + `/auth/verify-email` landing pages confirm the emailed link.

**Forgot/reset password shipped.** Link/token-based (not OTP): `/forgot-password` (neutral "if an account exists…" message, no enumeration) → emailed link → `/auth/reset-password?token=` landing.

---

## UI Reference (Designer Sketches)

These sketches are the source of truth for the two core flows.

---

### Barber POV — Staff Console (`/salons/:salonId/queues/:queueId/console`)

Two-panel layout side by side:

**Left panel — Current Client card**
- Header label: "Current Client"
- Large circle displaying the SERVING member's first name, running timer, and `eft:` finish time
- Party member list below the circle — shows all non-terminal members (SERVING + WAITING):
  - SERVING member: "Serving" badge + "+mins" + "Done" button
  - WAITING member: live per-member wait time (no action button — backend auto-advances after each Done)
- "End Session" button: if only one unfinished member → complete directly; if multiple unfinished → opens "End all" modal (calls `POST .../complete-all`)
- "View Queue" button — navigates to queue list panel

**Right panel — Queue list**
- Header: "Total Count: N" (total waiting)
- Two column headers: "Clients on queue" | "Wait time"
- Scrollable list; entries with a party show `+N kids` label
- Two action buttons at the bottom:
  - "Add Queue" — barber manually adds one or more clients to the queue
  - "Back" — returns to the left panel

---

### Customer POV — Visit + Join flow (`/s/:slug` → `/s/:slug/q/:queueId`)

Available in both the auth shell (`/s/:slug`) and guest shell (`/g/s/:slug`). **Services-first** — there is no separate "Choose Service" route/screen; picking a service and picking a barber both happen in place on the landing page, and joining opens an in-place dialog rather than navigating anywhere. This inverted an earlier barbers-first design (barber card → services list) — see `SalonLandingComponent`/`JoinDialogComponent` below.

**Screen 1 — Salon landing page**
- Salon avatar/photo at top left + salon name prominently below
- Short description line
- **Default view: services list.** Scrollable list of services (name + duration); tapping one switches the same screen to show only the barbers who offer that service (`staffForSelectedService` — client-side filter over the already-loaded slug payload, no request). A "← Services" link returns to the services list.
- Barber cards show: barber name + availability badge (green "Available" / red "Unavailable" / amber "On break"). Tapping a joinable barber card either opens the join dialog in place (fresh join), navigates straight to the position page (an active entry already exists for that queue), or redirects to `/register` (unauthenticated, no guest token) — `SalonVisitService.selectBarber()` decides which; the component only opens the dialog when it returns `true`.

**Join dialog (`JoinDialogComponent`, opened in place — no route)**
- Guest name/phone fields (guests only); authenticated users join as their account name
- "Add Kids" rows — name + service picker per extra party member, capped at `settings.maxPartySize`
- Cancel closes the dialog back to the barber list (no navigation). Confirm submits the whole party in one batch, then navigates to `/joining` (see below).

**Transient: `/joining` (`JoiningQueueComponent`)**
- "Finding your spot…" spinner shown immediately on submit (navigation-is-feedback — the app navigates before the POST resolves). A constructor `effect()` watches `SalonVisitService.pendingJoin()`; on success it replaces this route with the entry-scoped position page, on failure it toasts and navigates back.

**Position in line (`MyPositionComponent`, `q/:queueId/e/:entryId/position`)**
- Large circle center-screen showing:
  - "Position in line" label
  - Position number large
  - `est:` wait — hidden when position = 0 (entry is being served)
- Party member list — shows ALL members including leader ("You") + kids, each with:
  - "Serving" badge when being served
  - "Served" badge when done
  - Live per-member estimated wait when WAITING
- "Add Kids" button — hidden once service is complete
- Two buttons at the bottom: "View queue" | "Leave queue"
- **Service complete state:** when all members are done and the entry leaves the timeline, circle turns green with a checkmark and "Service complete" text; bottom bar shows a single "Back to salon" button

**Live queue view (`q/:queueId`, `LiveQueueComponent`)**
- Barber photo/avatar + name + availability badge
- Two column headers: "Waiting" | "Estimated time"
- Scrollable queue list, each row: client label (anonymized) + live countdown wait
- Entries with a party show `+N kids` label
- The user's own row highlighted green with label "Me"
- Two buttons at the bottom:
  - "Leave queue" (red/destructive — confirm dialog before calling DELETE)
  - "Back"

---

## Architecture Overview

**Framework:** Current Angular (standalone components — the default, never set `standalone: true`), signals, built-in control flow
**State:** Signals for view/store state; RxJS for streams (HTTP, WebSocket, refresh-token queuing, debounced inputs)
**Routing:** Three shell layouts — Public, Auth, Guest — each a layout component with `children`. Lazy feature routes (`loadComponent` / `loadChildren`) + functional guards
**HTTP:** `HttpClient` with functional interceptors; **all auth-user API calls go through the generated client**. Guest API calls use `GuestHttpService` (manual `HttpClient` with `Authorization: Bearer <guest-token>`)
**API types & services:** **Generated** by `ng-openapi-gen` from the backend's `/docs-json` — never hand-mirrored
**Real-time:** `socket.io-client` wrapped in `QueueSocketService` (backend namespace `/queues`, JWT or guest-token in the `auth` payload)
**Forms:** Typed Reactive Forms
**Styling:** Tailwind CSS utility classes; SCSS only when Tailwind genuinely cannot do it (complex keyframe animations, third-party overrides)
**Error contract:** The backend's uniform error envelope — the frontend **branches on `code`, never on `message`**

---

## Shell Architecture

The app has three layout shells, each a top-level route with `children`:

| Shell | Path prefix | Guard | Nav items |
|---|---|---|---|
| `PublicShellComponent` | `/` (path `''`) | none | `PublicNavComponent` (pill nav — desktop + mobile expandable); navItems: About, Contact, Sign In (auth slot), Sign Up (CTA) |
| `AuthShellComponent` | `/` (path `''`, second entry) | `authGuard` | Desktop: `SidebarComponent` + `TopBarComponent`; Mobile: `MobileTopBarComponent` + `MobileSheetComponent` + `BottomNavComponent`; navItems: Dashboard, My Visits (`/queues`), Account, Logout (sheet only) |
| `GuestShellComponent` | `/g` | `guestShellGuard` | Same layout components as auth shell but `[showLogout]="false"` on sidebar and `[showUserAvatar]="false"` on top bar; navItems: My Queues (`/g/queues`), Sign Up (CTA) |

The visit routes (`/s/:slug` and children) are mounted **inside both the auth shell and the guest shell** using the same lazy `visitRoutes`. A `data: { shellPrefix }` value on the route (`''` for auth, `'/g'` for guest) propagates to `SalonVisitService` so navigation targets the correct shell.

### Shell subcomponents (`shared/components/shells/`)

| Component | Inputs | Notes |
|---|---|---|
| `SidebarComponent` | `navItems`, `activeSalonId`, `membership`, `showLogout` (default true) | Desktop only (`hidden md:flex`). Collapsible — state persisted to `localStorage` key `hm_sidebar_collapsed`. Shows salon controls section when `activeSalonId` + `membership` provided. Emits `logoutClick` |
| `TopBarComponent` | `showUserAvatar` (default true), `salons`, `activeSalonId` | Desktop only. Salon switcher dropdown. Guest shell passes `showUserAvatar=false` and no salons |
| `MobileTopBarComponent` | `salons`, `activeSalonId`, `isGuest`, `showAppHeader` | Mobile app header. Reads the active route title and back fallback through `AppHeaderService`; shows the salon switcher below the title when available. The menu links to Profile (or Sign in for guests) and shares HairMela. The queue console keeps its own controls header while retaining the salon switcher row. |
| `MobileSheetComponent` | `navItems`, `open`, `activeSalonId`, `membership`, emits `closed` | Slide-up drawer. Shows salon controls when membership provided. Guest shell passes no `activeSalonId`/`membership` |
| `BottomNavComponent` | `navItems` | Mobile only (`flex md:hidden`). Filters items where `bottomNav: true`. Active tab: `routerLinkActive` template variable drives `text-primary` + bold label + dot indicator |
| `PublicNavComponent` | `navItems`, `sheetOpen`, emits `sheetToggle` | Desktop pill + mobile expandable. Logo + "HairMela" text link to `/` in both desktop left and mobile top row |

### NavItem shape (`nav-item.types.ts`)

```typescript
interface NavItem {
  label: string;
  icon: NavIcon;       // 'home' | 'queue' | 'bell' | 'person' | 'person-add' | 'login' | 'menu' | 'close' | 'scissors' | 'info' | 'mail'
  url?: string;
  action?: () => void;
  badge?: Signal<number>;
  cta?: boolean;       // renders as primary CTA button in bottom nav and public nav
  auth?: boolean;      // auth slot in public nav (alongside CTA)
  bottomNav?: boolean; // include in BottomNavComponent
  sidebar?: boolean;   // include in SidebarComponent
  sheet?: boolean;     // include in MobileSheetComponent
}
```

Auth shell `navItems`: `[Dashboard /dashboard, My Visits /queues, Account /account, Logout (action, sheet only)]`
Guest shell `navItems`: `[My Queues /g/queues, Sign Up /register (cta)]`
Public shell `navItems`: `[Sign In /login (auth), Sign Up /register (cta)]` — About and Contact are placeholder nav entries with no implemented routes yet.

### AuthShellComponent responsibilities
- On `ngOnInit`: calls `InvitesService.load()` + `DashboardService.load()` (both guard against double-fetch internally with `_loaded` flags)
- Reads `DashboardService.salons` + `SalonContextService.activeSalonId` → passes to `TopBarComponent` and `MobileTopBarComponent` for the salon switcher
- Reads `SalonContextService.membership` → passes to `SidebarComponent` and `MobileSheetComponent` for the salon controls section
- Logout: `SidebarComponent` emits `(logoutClick)` → `AuthShellComponent.logout()` → `AuthService.logout()`
- Route `title` and `data.backFallback` are the single source for app header text and back destinations. `AppHeaderService` derives them with a linked signal for both the mobile shell header and desktop/public `PageHeaderComponent`. The mobile header sits in the shell's normal flow, so its scroll area needs no hard-coded top inset; standard page headers are hidden on mobile inside auth/guest shells.

---

## Design Principle: Mirror the Backend's Control Layers

The frontend never enforces security — the backend does. The frontend mirrors each control so users only *see and attempt* what they're allowed to, and so the UI and the guards can never disagree.

| Backend control | Frontend counterpart | Data source |
|---|---|---|
| `JwtAuthGuard` | `authGuard` + jwt/refresh interceptors | `TokenStore` |
| `FlexAuthGuard` (guest or JWT) | `GuestHttpService` (manual Bearer header) + socket guest-token fallback | `GuestStore` |
| `@SalonRoles(...)` | `salonRoleGuard` + `*hasRole` | `GET /salons/:salonId/me` via `MembershipStore` |
| `@OrgOwner` | `orgOwnerGuard` | `GET /organizations/mine` |
| `@RequiresTier(n)` | `tierGuard` + `*requiresTier` (visible-but-locked) | `tier` from `/salons/:salonId/me` |
| `@RequiresVerifiedEmail` | **not gated on backend** — soft `VerifyEmailBannerComponent` nudge only (account page) | `emailVerified` from `/auth/me` |
| `@ActiveSalon` (downgrade freeze) | `tierFreeze` directive + `FrozenBannerComponent` + `SALON_FROZEN` handler; customer slug hides join on `isFrozen` | `isFrozen`/`staffFrozen` from `/salons/:salonId/me`, `isFrozen` from slug payload |
| Subscription tier/status/limits | `BillingService` + `OrgContextService` + `TierBannerComponent` + pre-blocking gates | `EffectiveAccessDto` from `.../subscription/me`, tier fields on `/me` |
| Error envelope + stable codes | `ApiError` type + error interceptor branching on `code` | `core/errors` |
| Pagination meta (`{data, meta}`) | `PaginatedMetaDto` model + shared `PaginationComponent` | generated client |
| WebSocket rooms & events | `QueueSocketService` typed streams | manual socket types |

---

## Generated API Layer (ng-openapi-gen)

**Config — `ng-openapi-gen.json`:**
```json
{
  "$schema": "node_modules/ng-openapi-gen/ng-openapi-gen-schema.json",
  "input": "http://localhost:3000/docs-json",
  "output": "src/app/api",
  "ignoreUnusedModels": false
}
```

**Scripts:** `"generate:api": "ng-openapi-gen --config ng-openapi-gen.json"`

**Rules:**
- `src/app/api/**` is generated — never hand-edited, regenerated after every backend DTO change.
- The generated `ApiConfiguration.rootUrl` is set from `environment.apiBaseUrl` in `app.config.ts`.
- Generated services are the only HTTP entry points for auth users. `GuestHttpService` handles guest-specific endpoints.
- The generated client uses **functional API** (`fn/` directory) — import individual functions, not service classes.

**What is NOT generated (maintained by hand in `core/`):**
- `error-codes.ts` — mirror of the backend's stable code enum
- `api-error.types.ts` — the error envelope shape `{ statusCode, code, message, details, timestamp, path, requestId }`; includes the `isApiError(body)` type guard — **must be called on `err.error` (the parsed body), never on the raw `HttpErrorResponse`**
- `socket.types.ts` — re-exports `TimelineEntryDto` from the generated models; defines `CustomerCalledPayload` and `ConnectionState`

**`isApiError` usage pattern:**
```typescript
error: (err: unknown) => {
  const body = (err as { error?: unknown })?.error;
  if (isApiError(body) && body.code === ErrorCodes.SOME_CODE) { ... }
}
```

---

## Folder Structure

```
src/app/
│
├── app.config.ts                    ← provideRouter, provideHttpClient(withInterceptors([...])),
│                                       provideAppInitializer(sessionInit),
│                                       ApiConfiguration.rootUrl = environment.apiBaseUrl
├── app.routes.ts                    ← top-level lazy routes (three shell groups)
├── app.ts                           ← root component (router-outlet only)
│
├── api/                             ← GENERATED (fn/ + models/) — never edit; run npm run generate:api
│
├── core/                            ← singletons (providedIn: 'root'), loaded once
│   ├── auth/
│   │   ├── auth.service.ts          ← login, register (clears guest token on success), logout, verify/resend
│   │   ├── token.store.ts           ← access token (memory signal) + refresh token (localStorage)
│   │   ├── current-user.store.ts    ← signal<User | null> hydrated from GET /auth/me
│   │   └── session-init.ts          ← app initializer: silent refresh → /auth/me → hydrate; cold-start redirect gated on Navigation Timing (`nav.type !== 'reload'`) so refresh at / doesn't bounce (see FIXMEs)
│   ├── guest/
│   │   ├── guest-store.ts           ← localStorage key `hairmela_guest` — token + entries[] + lastPath
│   │   ├── guest-http.service.ts    ← manual HttpClient with guest Bearer header for FlexAuthGuard routes (leaveQueue, addMembers, getGuestEntries)
│   │   └── guest-entry-validator.service.ts ← called on GuestShell mount: GET /queues/guest-entries → syncEntries()
│   ├── queue/
│   │   └── active-entry.store.ts    ← unified entry persistence; delegates to GuestStore (guest) or localStorage key `hairmela_active_entries` (auth)
│   ├── salon-context/
│   │   ├── salon-context.service.ts ← derives active salonId from route params; exposes membership + tier/status/isTrialing/daysLeft/staffFrozen/isFrozen/isReadOnly signals
│   │   ├── org-context.service.ts   ← caches the user's owned org + its effective access (salonLimit); goToBilling() resolves org on demand
│   │   ├── membership.store.ts      ← Map cache of GET /salons/:salonId/me; _toMembership() maps the DTO (incl. tier/status/freeze fields)
│   │   └── membership.types.ts      ← SalonRole enum + SubscriptionStatus + Membership interface
│   ├── tier/
│   │   ├── tier-limits.ts           ← SALON_LIMIT / STAFF_LIMIT (1_000_000 → ∞), TIER_NAMES, displayLimit()
│   │   └── tier-plans.ts            ← PLAN_CARDS — single source for plan copy (billing + pricing + plan-explainer)
│   ├── favorites/
│   │   └── favorites.service.ts     ← root-cached favoritedIds Set + favourites list; optimistic toggle; CacheRegistry registered
│   ├── push/
│   │   └── push.service.ts          ← SwPush wrapper: enable()/disable(), notification-click deep-link; guarded on isEnabled (prod build only)
│   ├── pwa/
│   │   └── install-prompt.service.ts ← cross-platform (android/ios/desktop) install-prompt detection/state for the how-to-install page
│   ├── clock/
│   │   └── server-clock.service.ts  ← server-skew-corrected clock; used by SalonVisitService for live countdowns
│   ├── caching/
│   │   ├── cache-registry/
│   │   │   └── cache-registry.service.ts ← Clearable interface + registry; AuthService calls clearAll() on logout
│   │   ├── optimistic/              ← optimistic.service.ts + cached-loader.ts — optimistic update engine (specs included)
│   │   ├── socket-predict/          ← socket-predict.service.ts — predict-then-confirm engine for socket-backed signals (spec included); used by QueueConsoleService
│   │   └── ttl/                     ← ttl-gate.ts + socket-invalidated-ttl.ts — TTL cache invalidated by socket events
│   ├── storage/
│   │   └── persistent-store.ts      ← single localStorage gateway (JSON + raw), try/catch'd
│   ├── guards/
│   │   ├── auth.guard.ts            ← authenticated → pass; refresh token → /login+returnUrl; /s/* URL → /g/s/*; guest token → /g/queues; else → /login
│   │   ├── guest.guard.ts           ← JWT-authenticated → /dashboard; guest-token users and unauthenticated → pass
│   │   ├── guest-shell.guard.ts     ← JWT-authenticated → /; everyone else → pass
│   │   ├── salon-role.guard.ts
│   │   ├── org-owner.guard.ts
│   │   ├── can-create-salon.guard.ts ← /salons/new: new users + owners pass; staff/admin-only → /dashboard
│   │   └── tier.guard.ts            ← requiredTier check; below → redirect to /org/:orgId/billing
│   ├── interceptors/
│   │   ├── jwt.interceptor.ts
│   │   ├── refresh.interceptor.ts
│   │   └── error.interceptor.ts
│   ├── errors/
│   │   ├── error-codes.ts
│   │   └── api-error.types.ts
│   ├── socket/
│   │   ├── queue-socket.service.ts  ← connect() uses TokenStore.getAccessToken() ?? GuestStore.getToken()
│   │   └── socket.types.ts
│   └── toast/
│       ├── toast.service.ts
│       └── toast.component.ts
│
├── shared/
│   ├── directives/
│   │   ├── has-role.directive.ts
│   │   ├── requires-tier.directive.ts
│   │   ├── tier-freeze.directive.ts   ← [tierFreeze]="isFrozen" — disables inner input/button/select/textarea
│   │   └── password-toggle.directive.ts ← eye icon show/hide on password fields
│   ├── pipes/
│   │   └── media-url.pipe.ts           ← relative /uploads path → apiBaseUrl-prefixed; absolute URLs pass through
│   └── components/
│       ├── shells/
│       │   ├── public-shell/        ← PublicShellComponent: PublicNavComponent + router-outlet; navItems: Sign In (auth), Sign Up (cta)
│       │   ├── auth-shell/          ← AuthShellComponent: Sidebar + TopBar + MobileTopBar + MobileSheet + BottomNav; loads InvitesService + DashboardService on init
│       │   ├── guest-shell/         ← GuestShellComponent: same layout as auth shell; showLogout=false, showUserAvatar=false; validates guest entries on init; tracks lastPath
│       │   ├── sidebar/             ← desktop only (hidden md:flex); collapsible (hm_sidebar_collapsed in localStorage); salon controls section driven by membership input; showLogout input
│       │   ├── top-bar/             ← desktop only; salon switcher dropdown; showUserAvatar input
│       │   ├── mobile-top-bar/      ← mobile app header with route title, back, menu, and salon switcher
│       │   ├── mobile-sheet/        ← slide-up drawer; salon controls section driven by membership input; closed output
│       │   ├── bottom-nav/          ← mobile only (flex md:hidden); bottomNav:true items only; active tab via routerLinkActive template var → text-primary + bold label + dot
│       │   ├── public-nav/          ← desktop pill nav + mobile expandable; logo+"HairMela" links to / in both viewports; Pricing/About/Contact + Sign In/Sign Up
│       │   ├── public-footer/        ← PublicFooterComponent — product/legal/support columns; in the public shell
│       │   ├── nav-icon/            ← renders SVG icon by name string (incl. 'heart' for Favourites)
│       │   └── nav-item.types.ts    ← NavItem + NavIcon union type
│       ├── salon-card/             ← shared listing card: slug link, auth-gated heart, mediaUrl pipe, /salon-placeholder.jpg fallback, fixed-height photo
│       ├── pagination/             ← PaginationComponent over {data, meta} — used by listing + favourites (+ notifications later)
│       ├── tier-banner/            ← trial/expired/free banner — rendered on the salon page, owner/admin only
│       ├── frozen-banner/          ← frozen-salon notice + upgrade CTA (owner) / informational (others)
│       ├── push-prompt/            ← contextual "notify me when it's your turn" after joining
│       ├── verify-email-banner/    ← unverified nudge + resend (account page)
│       ├── cookie-consent/         ← accept-all / reject-all, once per browser; in root app.ts
│       ├── install-banner/         ← site-wide PWA install nudge, driven by InstallPromptService, hides once installed; rendered in the public shell above the footer
│       ├── qr-scanner/             ← QrScannerComponent — camera-based QR scan (html5-qrcode) to jump to a salon by slug; used from the dashboard. Complements SalonShareComponent's QR *generation* (client-side, qrcode npm)
│       ├── confirm-dialog/
│       ├── connection-banner/      ← reads QueueSocketService.connectionState$ — reconnecting/disconnected banner on live queue views
│       ├── image-uploader/
│       ├── gallery/                ← reorder via @angular/cdk/drag-drop (CdkDragDrop/moveItemInArray)
│       ├── avatar/
│       ├── screen-layout/          ← reusable full-height shell: sticky header slot, scrollable body, fixed bottom action bar
│       └── skeleton/
│
├── marketing/                       ← public marketing pages (NOT under features/)
│   ├── landing/                     ← LandingComponent (salon listing homepage) + salon-listing.service.ts + geo-location.service.ts (disabled)
│   ├── pricing/                     ← PricingComponent — /pricing (renders from PLAN_CARDS)
│   ├── about/                       ← AboutComponent — /about
│   ├── contact/                     ← ContactComponent — /contact (logs values; API TODO)
│   ├── privacy/                     ← PrivacyComponent — /privacy
│   ├── terms/                       ← TermsComponent — /terms
│   └── how-to-install/              ← HowToInstallComponent — /how-to-install (PWA install instructions, uses InstallPromptService)
│
├── utils/
│   └── string.utils.ts              ← deslugify(slug): split on '-', capitalise each word
│
└── features/
    ├── auth/            (login, register, verify-email)
    ├── dashboard/
    │   ├── dashboard.component.ts/.html     ← routes to role-specific view based on membership
    │   ├── dashboard.service.ts             ← fetches /salons/mine + warms membership cache; _loaded guard; CacheRegistry registered
    │   ├── invites.service.ts               ← fetches pending invites; accept/decline; _loaded guard; CacheRegistry registered
    │   ├── owner-admin/
    │   │   └── owner-admin-dashboard.component.ts/.html
    │   ├── staff/
    │   │   └── staff-dashboard.component.ts/.html
    │   ├── customer/
    │   │   └── customer-dashboard.component.ts/.html    ← renders MyVisitsComponent with active entries
    │   ├── my-visits/
    │   │   └── my-visits.component.ts/.html ← MyVisitsComponent — presentational, takes `entries` input; not a route, used by CustomerDashboardComponent
    │   ├── salon/                           ← exists on disk but not rendered by DashboardComponent
    │   │   ├── salon-dashboard.component.ts/.html
    │   │   ├── my-salons-list/
    │   │   └── pending-invites/             ← PendingInvitesComponent — used by salon-dashboard (not by dashboard root)
    │   └── shared/
    │       └── no-salons-empty-state/
    ├── queues/
    │   ├── auth-queues/             ← AuthQueuesComponent at /queues — reads ActiveEntryStore (auth key); navigates to /s/:salonSlug/q/:queueId/e/:entryId/position
    │   └── guest-queues/            ← GuestQueuesComponent at /g/queues — reads ActiveEntryStore (guest key); navigates to /g/s/:salonSlug/q/:queueId/e/:entryId/position
    ├── notifications/               ← NotificationsComponent at /notifications — wraps PendingInvitesComponent
    ├── favorites/                   ← FavoritesPageComponent at /favorites — shared card grid + pagination over FavoritesService
    ├── organization/                (org-overview, org-settings, plan-explainer, billing/ — BillingComponent + DummySuccessComponent + billing.service.ts)
    ├── salons/                      (+ analytics/ — tier-gated Tier 2 scaffold; + leave-salon/ — LeaveSalonComponent at .../leave)
    ├── staff/                       (+ accept-invite/ — public invite landing)
    ├── services/
    ├── schedules/
    ├── closures/
    (salons/broadcasts/ — automated broadcasts page, mock service until backend ships)
    ├── queue/           (staff console — QueueShellComponent + CurrentClientComponent + QueueListComponent + QueueConsoleService)
    ├── visit/           (SalonShellComponent provides SalonVisitService; child routes shared by auth + guest shells via visitRoutes;
    │                      salon-landing/ services-first + in-place JoinDialogComponent, joining-queue/ transient spinner,
    │                      my-position/ entry-scoped position page, live-queue/ — no separate "Choose Service" route)
    └── account/         (+ reset-password/ + notifications-toggle/ + edit-profile/ — EditProfileComponent, PATCH /users/profile)
```

---

## Core: Auth & Session

### token.store.ts
- **Access token:** in-memory signal only — never persisted. Lost on reload by design.
- **Refresh token:** `localStorage`. Persistent sessions require a persisted credential; cookie-based refresh is the post-MVP path if requirements tighten.
- Exposes `isAuthenticated` computed from access-token presence.

### session-init.ts (`provideAppInitializer`)
Factory function, not a class. On boot:
1. If on root path `/`: if guest token present and no refresh token → redirect to `GuestStore.lastPath` (default `/g/queues`) and return early.
2. If refresh token present → `POST /auth/refresh` → store new token pair → `GET /auth/me` → hydrate `CurrentUserStore` → `socket.connect()`. On failure → clear tokens.
3. If on root path `/` after a successful refresh → navigate to `/dashboard`.

### auth.service.ts
- `login(dto)` → clears guest token (`GuestStore.clear()`), stores tokens, fetches `/auth/me`, connects socket.
- `register(dto)` → clears guest token on success. Does NOT fetch `/auth/me` or navigate — caller handles that.
- `logout()` → disconnects socket, clears tokens, clears `CurrentUserStore`, calls `MembershipStore.invalidateAll()`, calls `CacheRegistry.clearAll()`, clears `ActiveEntryStore`, navigates `/login`.
- `verifyEmail(token)` → `POST /auth/verify-email` then re-fetches `/auth/me`.
- `resendVerification()` → `POST /auth/resend-verification`.

### CacheRegistry (`core/caching/cache-registry/cache-registry.service.ts`)
Singleton registry for services that hold in-memory cache needing to be cleared on logout. Services call `cacheRegistry.register(this)` in their constructor; `AuthService.logout()` calls `cacheRegistry.clearAll()`. Currently registered: `DashboardService`, `InvitesService`.

### InvitesService (`features/dashboard/invites.service.ts`)
`providedIn: 'root'`. Loaded by `AuthShellComponent.ngOnInit()` alongside `DashboardService`. Fetches pending invites via `myInvitesControllerGetMyInvites`. Exposes `invites`, `loading`, `responding` signals. `accept(invite)` / `decline(invite)` call the respective endpoints, invalidate membership, and trigger `DashboardService.refresh()`. Registered with `CacheRegistry`. Guards against double-fetch with a `_loaded` flag.

### GuestStore (`core/guest/guest-store.ts`)
- `localStorage` key `hairmela_guest` — stores `{ token, entries[], lastPath }`.
- `token` — guest JWT from `POST .../walk-in` response (`res.body.guestToken`). Present only if user joined without an account.
- `entries[]` — guest entries mirroring `ActiveEntry` shape, used by `GuestQueuesComponent` and `ActiveEntryStore`.
- `syncEntries(liveIds)` — purges stale entries not present in the live backend list.
- Cleared entirely on `register()` so the guest session is irreversibly replaced by the real account.

### ActiveEntryStore (`core/queue/active-entry.store.ts`)
Unified persistence layer for "my current queue entry" — delegates to either `GuestStore` or a separate `localStorage` key `hairmela_active_entries` depending on whether the user is a guest.

- `getAll()` / `getForQueue(queueId)` / `save(entry)` / `remove(queueId)` / `clear()`
- `ActiveEntry` shape: `{ queueId, entryId, salonId, salonSlug }` — `salonSlug` stored so queues pages can navigate without a backend join.

### GuestHttpService (`core/guest/guest-http.service.ts`)
Manual `HttpClient` wrapper for the backend's `FlexAuthGuard` routes (those that accept either a real JWT or a guest token). Reads the guest token from `GuestStore` and injects it as `Authorization: Bearer <token>`. Used by `SalonVisitService` for `leaveQueue` and `addMembers` when the user is a guest.

### membership.store.ts + salon-context.service.ts
- `getMembership(salonId)` — returns cached membership as an immediately-completing Observable, or fetches `GET /salons/:salonId/me` and caches the result.
- `getCached(salonId)` — synchronous Map lookup; returns `null` if not yet fetched. Used by `DashboardComponent` (membership is pre-warmed by `DashboardService._fetch` via `forkJoin` before the dashboard renders).
- `invalidate(salonId)` — removes one entry from the cache (used after accept/decline invite, role change).
- `invalidateAll()` — clears the entire cache (used on logout via `AuthService`).

---

## Guards

| Guard | Logic | Used on |
|---|---|---|
| `authGuard` | No session: if refresh token present → `/login` with returnUrl; if URL starts with `/s/` → `/g/s/...`; if guest token → `/g/queues`; else → `/login` | auth shell routes |
| `guestGuard` | JWT-authenticated → `/dashboard`; guest-token users pass through (they need `/login` and `/register`) | `/login`, `/register` |
| `guestShellGuard` | JWT-authenticated → `/`; everyone else passes | `/g/*` |
| `salonRoleGuard` | Reads `:salonId`, awaits `MembershipStore.getMembership()`, checks `route.data.roles` | salon management routes |
| `canCreateSalonGuard` | new users (no salons) + owners pass; staff/admin-only (own nothing) → `/dashboard` | `/salons/new` |
| `orgOwnerGuard` | User owns `:orgId` | `/org/*` |
| `tierGuard` | `membership.tier >= route.data.requiredTier` → pass; else redirect to `/org/:orgId/billing` | `/salons/:salonId/analytics` (Tier 2); appointments later |

---

## Directives (template-level control)

**`*hasRole`** — structural; renders content only if the active-salon membership role is in the list. Reads `SalonContextService`.

**`*requiresTier`** — default mode **lock**: render disabled with a lock icon + "Upgrade to enable" nudge. Reads `membership().tier`.

**`tierFreeze`** (attribute) — when `isFrozen`, disables all inner `input/button/select/textarea`. Applied to the settings, service-form, and closures write forms (the actual write surfaces); list pages that use `<a routerLink>` links — which the directive can't disable — hide those controls with `!isFrozen` instead and show a `FrozenBannerComponent`. Enforcement is server-side (`SALON_FROZEN` handled centrally); this is honest pre-blocking. Invite-staff additionally blocks at Tier 1 (staff limit = owner only) via a component computed, not the directive.

---

## Interceptors (functional, ordered: jwt → refresh → error)

**`jwtInterceptor`** — attaches `Authorization: Bearer <access>` to requests targeting `environment.apiBaseUrl`, skipping auth + public endpoints. **Never attaches tokens to Cloudinary URLs.** Does not handle guest tokens — those are injected manually by `GuestHttpService`.

**`refreshInterceptor`** — on 401 + `TOKEN_EXPIRED`: single-flight refresh, queue and retry originals. Refresh fails or `TOKEN_INVALID` → logout. Never retries itself.

**`errorInterceptor`** — parses envelope into `ApiError`, branches on `code`, rethrows. Unknown/500: generic toast including `requestId`.

---

## Error Handling Convention

| Code(s) | Behavior |
|---|---|
| `TOKEN_EXPIRED` | Silent refresh + retry |
| `TOKEN_INVALID` | Logout + redirect to login |
| `INVALID_CREDENTIALS` | *local:* inline form error on login |
| `EMAIL_ALREADY_REGISTERED` | *local:* inline error on register |
| `EMAIL_NOT_VERIFIED` | **not handled** — verification is not gated server-side (soft nudge only) |
| `VALIDATION_FAILED` | *local:* map `details` onto form controls; toast fallback |
| `TIER_REQUIRED` | Central toast "requires a higher plan"; pre-blocked in UI where possible |
| `SALON_FROZEN` | Central toast "over the plan limit — upgrade to reactivate"; pre-blocked via `tierFreeze` |
| `STAFF_LIMIT_REACHED` | Central toast "staff limit reached — upgrade"; pre-blocked on invite-staff (Tier 1) |
| `SALON_LIMIT_REACHED` | *local:* upgrade nudge on Create Salon; pre-blocked via add-salon count gate |
| `SALON_SLUG_TAKEN`, `SERVICE_NAME_TAKEN`, `STAFF_ALREADY_INVITED` | *local:* inline field errors |
| `CANNOT_REMOVE_OWNER` | Toast directing to Transfer Ownership |
| `PARTY_TOO_LARGE` | *local:* inline error on join form |
| `QUEUE_NOT_OPEN`, `QUEUE_ALREADY_CLOSED` | Toast + refresh queue state; join CTA disabled |
| `ENTRY_NOT_WAITING`, `ENTRY_ALREADY_SERVING`, `MEMBER_NOT_SERVING`, `*_NOT_FOUND` | *local (console):* resolve-flow toast + timeline re-sync |
| `*_NOT_FOUND` (other) | Toast + navigate to nearest safe parent |
| Network error / non-envelope | "You appear to be offline" toast; queue views show socket reconnecting state |

---

## WebSocket Client (QueueSocketService)

**Connection:**
- `io(environment.socketUrl + '/queues', { auth: { token } })` — JWT in the **auth payload**, never the query string.
- `connect()` reads `TokenStore.getAccessToken() ?? GuestStore.getToken()` — so guest users get a live socket connection.
- On login/logout the socket reconnects/disconnects.

**API:**

| Member | Purpose |
|---|---|
| `connect()` / `disconnect()` | Lifecycle |
| `watchQueue(queueId)` | emit `joinQueue` — public room; server immediately replies with current `queueTimeline` |
| `watchQueueAsStaff(queueId)` | emit `joinQueueStaff` (token re-verified server-side) |
| `unwatchQueue(queueId)` | emit `leaveQueue` |
| `queueTimeline$(queueId)` | Observable of `TimelineEntryDto[]` — backed by `ReplaySubject(1)`; emits on both the initial `queueTimeline` event (server's immediate reply to `joinQueue`) and every subsequent `queue.updated` event |
| `customerCalled$(queueId)` | room-level called broadcast (anonymized) |
| `connectionState$` | connected / reconnecting — surfaced as a banner on live views |

**Reconnect discipline:** on reconnect, re-emit `joinQueue`/`joinQueueStaff` for every watched queue. The immediate `queueTimeline` reply doubles as state resync.

---

## Live Wait Time Countdown

**How it works:**
- `TimelineMemberDto.servedAt: string | null` — ISO timestamp stamped by the backend when a member starts SERVING
- Every live view runs a `setInterval` ticking a signal every second. The staff console (`QueueConsoleService`) uses a plain local `_tick` signal. The customer visit (`SalonVisitService`) instead uses root-scoped `ServerClockService`: `sync(serverTimeIso)` records the client/server clock offset whenever a fresh server timestamp arrives (e.g. on a timeline payload), and `now()` returns drift-corrected time in its place — protecting the customer-facing countdown from a skewed client clock, which the console's simpler tick doesn't bother with (staff are trusted to have roughly-correct clocks; customers on arbitrary devices are not).
- `liveWaitMinutes` — `computed()` Map of `entryId → number` subtracting elapsed minutes from each entry's `estimatedWaitMinutes`
- `memberWaitMinutes` — `computed()` Map of `memberId → number`: SERVED → 0, SERVING → 0, WAITING → accumulated remaining duration of preceding active members minus elapsed
- The barber's stopwatch (`timerFromServedAt`) derives from the same `servedAt` — accurate on console reload

**Why this works for all clients simultaneously:** every browser receives the same `queueTimeline` snapshot (including `servedAt`) from the socket. Each browser independently runs the countdown arithmetic from that shared timestamp.

---

## SalonVisitService

`providedIn: 'root'` — shared across all child routes under the salon shell. Reset on `destroy()`.

Key responsibilities:
- `init(slug, shellPrefix)` — loads salon + services + restores active entry from `ActiveEntryStore`. `shellPrefix` is `'/g'` for guest shell, `''` for auth shell; used to compute navigation targets.
- `watchQueue(queueId)` — joins socket room + calls `connect()` (so guest socket connects if not already). Uses `_socketInitialReceived` Set to suppress "You're up!" banner on the initial timeline reply.
- `timelineLoaded` signal — set to `true` only after `activeEntry` is reconciled from the store. Guards in `MyPositionComponent` wait for this before evaluating "Service complete" state, preventing false positives on page reload.
- `_loadInitialTimeline(queueId)` — for auth users with no stored entry, falls back to `GET /queues/my-entries` to recover `entryId` (handles the case where guest store was cleared on registration but the backend entry persists).
- `joinQueue()` — sets `pendingJoin` and posts the whole party in one batch; the caller (`JoinDialogComponent`) navigates to `/joining` immediately, before the response lands (navigation-is-feedback). On success stores `res.body.guestToken` in `GuestStore` (if present) and the entry in `ActiveEntryStore`; `JoiningQueueComponent`'s effect reacts to `pendingJoin` resolving and completes the navigation to the entry-scoped position page.
- `leaveQueue()` / `addMembers()` — route to `GuestHttpService` when `GuestStore.hasToken()`, otherwise to the generated client. Both paths call `_loadInitialTimeline` on success to immediately refresh the party list.
- `selectBarber()` — checks `ActiveEntryStore` for an existing entry on that queue; if found, navigates straight to the entry-scoped position page and returns `false`. Unauthenticated + no guest token → redirects to `/register` with returnUrl, returns `false`. Otherwise returns `true`, and the landing page opens `JoinDialogComponent` in place — there is no `/join` route or "Choose Service" screen; the service being joined for is already known (selected on the landing page itself) and carried into the dialog as an input.

---

## Queues Pages (`features/queues/`)

Two components sharing the same visual design but different navigation targets:

| Component | Route | Data source | Navigate to |
|---|---|---|---|
| `AuthQueuesComponent` | `/queues` | `myEntriesControllerGetMyEntries` (REST) — live list from backend; `ActiveEntryStore.getForQueue()` for `salonSlug` | `/s/:salonSlug/q/:queueId/e/:entryId/position` |
| `GuestQueuesComponent` | `/g/queues` | `GuestHttpService.getGuestEntries()` (REST with guest token) — live list from backend; `ActiveEntryStore.getForQueue()` for `salonSlug` | `/g/s/:salonSlug/q/:queueId/e/:entryId/position` |

Both use `deslugify(salonSlug)` from `src/app/utils/string.utils.ts` to display the salon name. Navigation is blocked (`return`) if `salonSlug` is not in `ActiveEntryStore` for that queue.

---

## Dashboard (`features/dashboard/`)

`DashboardComponent` delegates data loading to `DashboardService.load()` (guarded by `_loaded` flag — no double-fetch). `DashboardService._fetch` calls `/salons/mine` then `forkJoin` of `getMembership()` for each salon — membership is warm before the template renders.

On load, an `effect()` writes `?salon=<firstSalonId>` into the URL query params (replaceUrl: true) if no `?salon=` is present, so the active salon is always explicit in the URL.

Role computed from `MembershipStore.getCached(activeSalon.id)?.role ?? activeSalon.role`:

| Condition | View |
|---|---|
| `salons.length === 0` | `CustomerDashboardComponent` — "Find a salon" CTA + "Create a salon" button |
| `role === 'OWNER' \|\| role === 'ADMIN'` | `OwnerAdminDashboardComponent` — greeting, salon header, quick links (Staff / Services / Settings / Share), "Create another salon" |
| `role === 'STAFF'` | `StaffDashboardComponent` — greeting, salon header, quick links (My Services / Closures) |

The `salon/` subfolder (`SalonDashboardComponent`, `MySalonsListComponent`, `PendingInvitesComponent`) exists in the file system but is **not used by `DashboardComponent`** — invite handling is done by `InvitesService` (loaded by `AuthShellComponent`) and displayed by `PendingInvitesComponent` which lives at `features/dashboard/salon/pending-invites/`.

**Guards:** `authGuard` (inherited from auth shell).

---

## Feature Modules

### Auth — `features/auth/`
**Routes (inside public shell):** `/login`, `/register`, `/forgot-password`, `/auth/reset-password`, `/verify-email` (+ `/auth/verify-email`)

| Component | Endpoint |
|---|---|
| `LoginComponent` | POST /auth/login (+ "Forgot password?" link, `?reset=1` success banner) |
| `RegisterComponent` | POST /auth/register — clears guest token on success |
| `ForgotPasswordComponent` | POST /auth/forgot-password — always-neutral message, no enumeration |
| `ResetPasswordPageComponent` | POST /auth/reset-password — reads `?token=`; no token → invalid |
| `VerifyEmailComponent` | POST /auth/verify-email — resend on failure when logged in |

All password fields use the `appPasswordToggle` directive (eye icon show/hide).
**Guards:** `guestGuard` on login/register/forgot-password; reset-password + verify-email are public (token-authorized / reachable with a stale session). Staff invite-accept lives under `features/staff/accept-invite` at `/staff/accept-invite` (public, handles logged-in and logged-out invitees inline).

### Notifications — `features/notifications/`
**Route:** `/notifications` — wraps `PendingInvitesComponent`. **Guards:** `authGuard`.

### Organization — `features/organization/`
**Routes:** `/org/:orgId`, `/org/:orgId/settings`, `/org/:orgId/plan`

| Component | Endpoint |
|---|---|
| `OrgOverviewComponent` | GET /organizations/:orgId |
| `OrgSettingsComponent` | PATCH /organizations/:orgId |
| `PlanExplainerComponent` | — (static teaser; renders from `PLAN_CARDS`, links to billing) |
| `BillingComponent` | GET/POST `.../subscription/me` `checkout` `verify` `downgrade` `cancel` via `BillingService`; on iOS (`billingMode === 'iap'`) `IapPaymentUiComponent` buys through Apple and confirms via POST `.../subscription/apple/sync`. `BillingService.iapConfirm` (`purchasing` → `confirming` → `delayed`) is deliberately separate from `acting`, which app resume clears, and Apple's sheet triggers a resume |
| `DummySuccessComponent` | reads `?reference=`, calls verify, redirects to billing |

**Guards:** `authGuard + orgOwnerGuard`. Billing is owner-only (nav hidden for non-owners; backend 403s as safety net). Upgrade = immediate (`checkout`→`verify`→re-fetch `/me`); downgrade/cancel = scheduled at period end (`pendingTier`/`endsAt`).

### Salons — `features/salons/`
**Routes:** `/salons/new`, `/salons/:salonId`, `/salons/:salonId/settings`, `/salons/:salonId/slug`, `/salons/:salonId/share`, `/salons/:salonId/delete`, `/salons/:salonId/media`

| Component | Endpoint |
|---|---|
| `CreateSalonComponent` | POST /salons |
| `SalonOverviewComponent` | GET /salons/:salonId |
| `SalonSettingsComponent` | PATCH /salons/:salonId, PATCH .../settings |
| `SalonSlugComponent` | PATCH /salons/:salonId/slug |
| `SalonShareComponent` | — (client-side QR via `qrcode` npm — resolve as `mod.default.toDataURL ?? mod.toDataURL`) |
| `DeleteSalonComponent` | DELETE /salons/:salonId |
| `SalonMediaComponent` | GET/POST/DELETE/PATCH /salons/:salonId/media |

### Staff — `features/staff/`
**Routes** (all under `/salons/:salonId/staff`): list, invite, `:staffId`, `:staffId/media`, `:staffId/services`, `:staffId/schedules`, `:staffId/closures`

| Component | Endpoint |
|---|---|
| `StaffListComponent` | GET /salons/:salonId/staff → `{ staff, queueId }[]` |
| `InviteStaffComponent` | POST .../staff/invite |
| `StaffDetailComponent` | PATCH .../staff/:staffId/role, DELETE .../staff/:staffId, PATCH .../staff/transfer-ownership |
| `StaffMediaComponent` | GET/POST/DELETE/PATCH .../staff/:staffId/media |
| `PendingInvitesComponent` | POST .../staff/accept, POST .../staff/decline |

### Services — `features/services/`

| Component | Endpoint |
|---|---|
| `ServiceListComponent` | GET /salons/:salonId/services (`publicServicesControllerFindBySalon`) |
| `ServiceFormComponent` | POST + PATCH .../services |
| `StaffServiceAssignComponent` | `forkJoin` of salon services + staff services + staff list; POST/DELETE .../staff/:staffId/services, PATCH .../default-service |

**Model note:** `GET .../staff/:staffId/services` returns `StaffService[]` — shape `{ id, serviceId, staffId, service: Service, staff: SalonStaff }`. Default service ID at `SalonStaff.defaultServiceId`.

### Schedules — `features/schedules/`
`WeeklyScheduleComponent` — 7-day grid of per-day working hours. Routes nested under `/salons/:salonId/staff/:staffId/schedules`. **Guards:** `salonRoleGuard(OWNER, ADMIN)`.

### Closures — `features/closures/`
`ClosuresComponent` — dual-scope: detects whether `staffId` param is present and switches between salon-wide and per-staff API calls. Routes: `/salons/:salonId/closures` and `/salons/:salonId/staff/:staffId/closures`. **Guards:** `salonRoleGuard(OWNER, ADMIN)`.

### Automated broadcasts — `features/salons/broadcasts/`
`BroadcastAutomationsComponent` at `/salons/:salonId/broadcasts` — list of scheduled broadcasts (schedule sentence, next/last send, run status, pause/resume, edit, delete) plus an inline create/edit form (message, optional image, ONCE/DAILY/WEEKLY/MONTHLY/EVERY_N_DAYS schedule, salon-time picker, live preview sentence). Max 5 active (New/Resume disabled at the limit). **Guards:** `salonRoleGuard(OWNER, ADMIN)`. Linked from the owner's broadcast thread header in chat ("Scheduled") and from `BroadcastModalComponent`.

**Wired to the real API** via the generated `salonBroadcastAutomationsController*` functions (`BroadcastAutomationsService` is a thin wrapper; types are the generated `BroadcastAutomationResponseDto` + schedule union, aliased in `broadcast-automation.types.ts`). Schedule sentences, run-status labels and the same-day overlap check live in `broadcast-schedule.utils.ts` (spec'd). Channels (IN_APP/SMS/WhatsApp) render from the audience endpoint's `availableChannels`; a sent one-time automation shows "Sent" with a "Send again" action (saves a new date and `isActive: true` together).

### Queue (staff console) — `features/queue/`
**Route:** `/salons/:salonId/queues/:queueId/console`

`QueueShellComponent` provides `QueueConsoleService` via `providers: [QueueConsoleService]` (scoped to the shell — NOT `providedIn: 'root'`). Two child routes: `''` → `CurrentClientComponent`, `'queue'` → `QueueListComponent`. `QueueShellComponent.ngOnInit()` calls `console.init(salonId, queueId)`; `ngOnDestroy` calls `console.destroy(queueId)`.

`AuthShellComponent` also provides its own `QueueConsoleService`, used only to back the add-client modal it opens from outside a queue page. Open that modal through root `AddClientModalService` (`openWalkIn` / `openAppointment`), never a shell-local flag: it routes the request to the queue shell when that shell is showing the same queue (`pageRequest`), otherwise to the auth shell (`shellRequest`). An add paints its optimistic temp row into the hosting shell's console, so hosting it anywhere else leaves the queue page blank until the socket frame lands.

`QueueConsoleService` (~900 lines) grew substantially past its original simple socket-plus-REST design while chasing a production race-condition bug (client name flashing away and reappearing in the current-client circle). The engine it ended up with:

- **Two-source timeline:** `_serverTimeline` (authoritative, written only by socket frames + REST fallback, no reconciliation/timestamp comparison) and `_optimisticAdds` (an overlay of client-painted temp entries for `staffAddToQueue`, keyed by `temp_`-prefixed ids). The `timeline` computed merges them, dropping a temp the instant its confirmed real entry appears server-side — so there's never a frame where both or neither render, regardless of which lands first.
- **Lock lifecycle:** `_pendingIds` + `isLocked(id)` — a row is locked while its own mutation is in flight (unlocked when that mutation's HTTP response settles, not when the next socket frame arrives — waiting on a frame can hang forever on a quiet queue) or while it's still a `temp_` id (unconfirmed by definition). Every button's `[disabled]` reads this one gate.
- **Serialized action queue (`_actionQueue$`, `concatMap`):** every mutation's *paint* happens synchronously on click (instant feedback), but the actual HTTP dispatch is queued one-at-a-time per console session. This exists because two independent mutations fired back-to-back (e.g. End Session immediately followed by Call Next) can otherwise reach the backend out of order and 409 against the backend's "one SERVING entry" invariant — serializing dispatch order removes the race without making the UI wait.
- **Call Next spinner (`callNextWaiting`):** Call Next's promoted client name is normally painted immediately (safe — nothing else was in flight to race). But if Call Next was queued behind another still-in-flight action, painting immediately risks a stale intermediate socket frame (reflecting the moment right after the queued-ahead action committed, before Call Next's own commit) clobbering the paint and flashing the name away — repeated attempts to "hold" the predicted name through that window still flashed in production. So in that specific case the circle shows a spinner + "Calling next person…" instead of a name, and only paints once a genuine confirming socket frame (not the optimistic paint) shows that entry's leader SERVING.

| Responsibility | Endpoint / Socket |
|---|---|
| Initial timeline | GET /queues/:queueId/timeline |
| Queue status + staff services | GET /queues/:queueId → `switchMap` → GET /salons/:salonId/staff/:staffId/services (chained in `_loadQueueStatus`) |
| Live timeline | `watchQueueAsStaff` + `queueTimeline$` |
| Live stopwatch | `timerFromServedAt` computed from `servedAt` (via `displayServingMember`, which is `null` while `callNextWaiting`) |
| Live wait times | `liveWait(entryId)` / `memberWait(memberId)` from computed maps |
| Set status | PATCH .../status |
| Call next | POST .../call-next (409 → resolve-flow toast) |
| Complete member | PATCH .../members/:memberId/complete — mirrors the backend's auto-promotion of the next WAITING party member locally, so multi-member parties don't flash empty between Done and the confirming frame |
| Complete all | POST .../entries/:entryId/complete-all |
| No-show | PATCH .../entries/:entryId/no-show |
| Cancel entry | DELETE .../entries/:entryId |
| Extend member | PATCH .../members/:memberId/extend |
| Staff manual add | POST .../walk-in (staff-initiated) — paints a `temp_` entry into `_optimisticAdds`, locked until the real entry is confirmed |

**Guards:** `salonRoleGuard(OWNER, ADMIN, STAFF)`.

### Visit (customer-facing) — `features/visit/`

**Routes** — mounted under BOTH auth shell (`/s/:slug`) and guest shell (`/g/s/:slug`). Same `visitRoutes` lazy module, distinguished by `data: { shellPrefix }`.

- `/s/:slug` / `/g/s/:slug` → `SalonLandingComponent` — services-first: services list by default, tap a service to see the barbers offering it, tap a joinable barber to open `JoinDialogComponent` in place. No separate route for service selection or joining.
- `q/:queueId` → `LiveQueueComponent`
- `q/:queueId/joining` → `JoiningQueueComponent` — transient "Finding your spot…" screen, navigated to immediately on submit (navigation-is-feedback); resolves via `SalonVisitService.pendingJoin()`
- `q/:queueId/e/:entryId/position` → `MyPositionComponent` — entry-scoped, not a flat `/position` path

`SalonShellComponent` injects `SalonVisitService` (which is `providedIn: 'root'`) and on `ngOnInit` calls `visit.init(slug, shellPrefix)` where `shellPrefix` is read from `route.snapshot.data['shellPrefix']`. On `ngOnDestroy` calls `visit.destroy()` to reset all signals and clear watched queues.

| Responsibility | Endpoint / Socket |
|---|---|
| Salon + staff data | GET /salons/slug/:slug |
| Services | GET /salons/:salonId/services |
| Queue status | GET /queues/:queueId |
| Initial timeline | GET /queues/:queueId/timeline (+ re-fetch after join) |
| Live timeline | `watchQueue` + `queueTimeline$` |
| Join queue | POST .../walk-in — single batch call for the whole party (leader + kids); response includes `{ entry, guestToken? }` |
| Leave queue | `GuestHttpService.leaveQueue` (guest) or generated client (auth) |
| Add members | `GuestHttpService.addMembers` (guest) or generated client (auth) — re-fetches timeline on success |
| My active entry | `ActiveEntryStore` (unified over guest/auth localStorage) |
| Stale entry guard | On each timeline update: validate stored `entryId`; if absent → purge + clear `activeEntry` |
| Called banner | Auto-shown 5s when entry flips to SERVING — suppressed on initial socket reply via `_socketInitialReceived` Set |
| Service complete | `timelineLoaded` must be `true` before `MyPositionComponent` evaluates; prevents false positive on reload |

**Guards:** `authGuard` for auth shell; `guestShellGuard` for guest shell (`/g/*`).

### Account — `features/account/`
**Route:** `/account` — read-only profile from `CurrentUserStore`. Hosts `VerifyEmailBannerComponent` (unverified nudge + resend), `ResetPasswordComponent` (send-reset-link to own email), and `NotificationsToggleComponent` (push on/off). Logout button calls `AuthService.logout()`. **Guards:** `authGuard`.

### Favourites — `features/favorites/`
**Route:** `/favorites` (auth shell). `FavoritesPageComponent` renders the shared `SalonCardComponent` grid + `PaginationComponent`, fed by root-scoped `FavoritesService` (`GET /users/me/favorites`). The service caches `favoritedIds` (a `Set` used to render heart state on every card app-wide) and the current favourites page; `toggle()` is optimistic and patches both caches in place (or invalidates the list when adding from a page that lacks full card data, e.g. the salon detail page). **Guards:** `authGuard`; nav entry (sidebar + bottom nav) is inherently auth-gated by the shell.

### Marketing & legal — `marketing/`
**Routes (public shell):** `/` (salon listing homepage — `LandingComponent` + `SalonListingService`), `/pricing`, `/about`, `/contact`, `/privacy`, `/terms`. The homepage is the primary above-the-fold content: compact hero → sticky search bar → paginated salon grid (18/page = 6 rows, no infinite scroll) → the old marketing sections below. `PublicFooterComponent` and `CookieConsentComponent` are app-wide (footer in the public shell; cookie banner in the root `app.ts` alongside toast + confirm-dialog).

---

## Routing Map

```
/                                   public shell (PublicShellComponent) — salon listing homepage
/pricing                            public shell — plan comparison (Tier 1 card commented until launch)
/about                              public shell
/contact                            public shell — contact form (logs values; API TODO)
/privacy                            public shell
/terms                              public shell
/how-to-install                     public shell — PWA install instructions
/verify-email                       public shell (also /auth/verify-email — emailed-link convention)
/login                              public shell + guestGuard
/register                           public shell + guestGuard
/forgot-password                    public shell + guestGuard
/auth/reset-password                public shell (token-authorized; no guard — reachable with stale session)
/staff/accept-invite                public shell (invite token; handles logged-in + logged-out inline)

/g                                  guest shell (GuestShellComponent) + guestShellGuard
  /g/queues                         GuestQueuesComponent
  /g/s/:slug                        visitRoutes (shellPrefix = '/g')
    /g/s/:slug/q/:queueId
    /g/s/:slug/q/:queueId/joining
    /g/s/:slug/q/:queueId/e/:entryId/position

/                                   auth shell (AuthShellComponent) + authGuard
  /dashboard                        DashboardComponent
  /account                          AccountComponent (+ verify-email banner + notifications toggle)
  /account/edit-profile             EditProfileComponent — PATCH /users/profile
  /notifications                    NotificationsComponent
  /queues                           AuthQueuesComponent
  /favorites                        FavoritesPageComponent
  /s/:slug                          visitRoutes (shellPrefix = '')
    /s/:slug/q/:queueId
    /s/:slug/q/:queueId/joining
    /s/:slug/q/:queueId/e/:entryId/position
  /org/:orgId                       + orgOwnerGuard
  /org/:orgId/settings              + orgOwnerGuard
  /org/:orgId/plan                  + orgOwnerGuard — static plan teaser → links to billing
  /org/:orgId/billing               + orgOwnerGuard — live subscription (upgrade/downgrade/cancel)
  /org/:orgId/billing/dummy-success + orgOwnerGuard — reads ?reference=, verifies, redirects
  /salons/new
  /salons/:salonId                  + salonRoleGuard(OWNER,ADMIN,STAFF)
  /salons/:salonId/settings         + salonRoleGuard(OWNER,ADMIN)
  /salons/:salonId/slug             + salonRoleGuard(OWNER)
  /salons/:salonId/share            + salonRoleGuard(OWNER,ADMIN)
  /salons/:salonId/delete           + salonRoleGuard(OWNER)
  /salons/:salonId/leave            + salonRoleGuard(OWNER,ADMIN,STAFF)
  /salons/:salonId/analytics        + salonRoleGuard(OWNER,ADMIN) + tierGuard(requiredTier 2)
  /salons/:salonId/media            + salonRoleGuard(OWNER,ADMIN,STAFF)
  /salons/:salonId/closures         + salonRoleGuard(OWNER,ADMIN)
  /salons/:salonId/broadcasts       + salonRoleGuard(OWNER,ADMIN)
  /salons/:salonId/services         + salonRoleGuard(OWNER,ADMIN,STAFF)
  /salons/:salonId/services/new     + salonRoleGuard(OWNER,ADMIN)
  /salons/:salonId/services/:serviceId/edit + salonRoleGuard(OWNER,ADMIN)
  /salons/:salonId/staff            + salonRoleGuard(OWNER,ADMIN,STAFF)
  /salons/:salonId/staff/invite     + salonRoleGuard(OWNER,ADMIN)
  /salons/:salonId/staff/:staffId   + salonRoleGuard(OWNER,ADMIN,STAFF)
  /salons/:salonId/staff/:staffId/media      + salonRoleGuard(OWNER,ADMIN)
  /salons/:salonId/staff/:staffId/services   + salonRoleGuard(OWNER,ADMIN,STAFF)
  /salons/:salonId/staff/:staffId/schedules  + salonRoleGuard(OWNER,ADMIN)
  /salons/:salonId/staff/:staffId/closures   + salonRoleGuard(OWNER,ADMIN)
  /salons/:salonId/queues/:id/console        + salonRoleGuard(OWNER,ADMIN,STAFF)
    ''      → CurrentClientComponent
    queue   → QueueListComponent
```

---

## State Management Strategy

- **Session:** `TokenStore` + `CurrentUserStore` — single source of truth for `authGuard`.
- **Guest session:** `GuestStore` — single source for guest token, guest entries, and `guestShellGuard`.
- **Active entries (unified):** `ActiveEntryStore` — delegates to `GuestStore` (guest) or `hairmela_active_entries` localStorage (auth). Shape includes `salonSlug` so queue list pages can navigate without a backend join.
- **Per-salon authorization + tier:** `MembershipStore` behind `SalonContextService` (exposes tier/status/freeze/trial signals). Invalidated on billing actions.
- **Owned org + effective access:** `OrgContextService` — caches the user's org and its `salonLimit`; `goToBilling()` resolves on demand. Warmed once in the auth shell.
- **Favourites:** `FavoritesService` (root) — caches `favoritedIds` (Set, drives heart state everywhere) + the favourites list page; optimistic `toggle()` patches both in place. Cleared on logout via `CacheRegistry`.
- **Homepage listing:** `SalonListingService` (route-scoped `providedIn` on the component) — debounced search + state/city filter + pagination signals; not globally cached (staleness is fine, YAGNI).
- **Customers:** `CustomersService` caches salon customers, staff summaries, and staff customers per salon/staff, page, and search. It replays cached results immediately and revalidates in the background; pending requests are shared. Each typed request cache retains 40 recent results, including empty results; stale search responses cannot replace cleared or newer searches.
- **Chat:** `ChatService` caches scoped inbox results and keeps each conversation's loaded message history in shared signals. Re-entry shows cached content immediately while REST quietly revalidates. Socket messages, badges, and receipts patch cached previews, unread counts, and history; live events do not refetch known inbox rows. Unknown threads and reconnects trigger reconciliation. History refreshes preserve older pages, optimistic messages, and newer receipts, and catch up across pages to the last confirmed history snapshot after missed messages. A new-thread badge or reconnect during an inbox fetch schedules another quiet reconciliation. Each thread groups its messages, history cursor, receipts, and active/request state. The cache retains 50 recent thread states and 200 saved messages per inactive thread; active views and pending sends are protected from eviction, and trimmed history remains loadable. Conversation changes on a reused route switch the shared message signal reactively. Foreground/online/reconnect events reconcile silently, using the current token at every socket handshake. Partial badge previews omit unknown message IDs and sender roles until REST confirms them. Old unread/read responses cannot erase newer state. Both chat and customer caches clear through `CacheRegistry` on logout; audio players and temporary recording URLs are released when replaced or discarded.
- **Native chat layout:** the Capacitor mobile thread fills the shell's available content height and reserves a gap above bottom navigation, accounting for the actual header and safe areas. Browser/PWA sizing is unchanged.
- **Live queue state:** socket-fed signals. REST timeline is initial paint + reconnect fallback only. **Never cached.**
- **Live countdown:** `_tick` signal incremented by `setInterval` → `liveWaitMinutes` / `memberWaitMinutes` computed maps.
- **RxJS:** socket streams, single-flight refresh queuing. Everything else is signals.

---

## Frontend Engineering Standards

### Angular
- Standalone components; `input()` / `output()` functions; `inject()`, not constructor injection.
- `signal()` for local mutable state, `computed()` for derived state, `effect()` sparingly.
- Templates: `@if` / `@for` (with `track`) / `@switch`; `class`/`style` bindings, not `ngClass`/`ngStyle`; no arrow functions or `new Date()` in templates.
- Every route lazy; every subscription cleaned up with `takeUntilDestroyed`.
- **Templates are always external files** — never `template:` inline.
- **Styling is Tailwind-first** — no `.scss` unless Tailwind genuinely cannot do it.

### Error handling
- `isApiError` must be called on `err.error` (the parsed body), **not** on the raw `HttpErrorResponse`.
- Errors flow through the central interceptor; features add `catchError` only for flow-specific codes. Never swallow silently.

### Mobile Responsiveness
- **Every component and page must be mobile responsive — no exceptions.** HairMela is primarily a mobile-use product.
- Design mobile-first. Touch targets at least 44×44px.

### Utils
- `src/app/utils/string.utils.ts` — `deslugify(slug)`: splits on `-`, capitalises each word. Use instead of asking the backend to join relations when a human-readable name is needed from a slug.

### Configuration discipline
- `environment.ts` owns `apiBaseUrl` (with `/v1`), `socketUrl`, `appBaseUrl`, `cloudinaryCloudName`. No URL literals in source.
- `app.config.ts` registers `provideCloudinaryLoader(\`https://res.cloudinary.com/${environment.cloudinaryCloudName}\`)` — every `NgOptimizedImage` in the app is rewritten through Cloudinary's CDN/transform pipeline app-wide, not per-component.

### Working with Claude
- Before investigating or implementing any bug report or feature request, Claude must restate its understanding back to the user first (see `.claude/CLAUDE.md` §1) — every time, not just when uncertain.

---

## Build Status

All 7 MVP phases are complete ✅ — plus post-Phase 7 shell work:

| Phase | Work |
|---|---|
| 1 ✅ | Foundation & Auth: workspace, environments, generated API client, error types, interceptors, TokenStore, CurrentUserStore, session init, ToastService, Login, Register, verify-email, authGuard/guestGuard |
| 2 ✅ | Authorization layer: MembershipStore, SalonContextService, salonRoleGuard, orgOwnerGuard, tierGuard, *hasRole, *requiresTier, tierFreeze |
| 3 ✅ | Dashboard (role-split: OwnerAdminDashboard / StaffDashboard / CustomerDashboard), Org, Salons, Staff, Notifications page |
| 4 ✅ | Media: image-uploader, avatar, gallery + reorder |
| 5 ✅ | Services: catalog CRUD, staff-service assignment, default service |
| 6 ✅ | Schedules + Closures |
| 7 ✅ | Queues: QueueSocketService, staff console, salon visit, live countdown, stale-entry validation, CalledBanner, leave |
| Post-7 ✅ | Three-shell architecture (PublicShell / AuthShell / GuestShell), GuestStore, ActiveEntryStore, GuestHttpService, guestShellGuard, guest socket support, AuthQueuesComponent, GuestQueuesComponent, deslugify util, bottom-nav active highlight |
| 8 ✅ | **Tier & Billing:** expanded `/salons/:salonId/me` (tier, status, isTrialing, trialEndsAt, daysLeft, staffFrozen), `tier-limits.ts` + `tier-plans.ts` constants, `OrgContextService` (owned-org + effective-access cache), billing page (`/org/:orgId/billing` — subscription/me, checkout→verify upgrade, scheduled downgrade/cancel, dummy-success), `TierBannerComponent` (trial/expired/free — salon page only, owner/admin), `plan-explainer` repurposed as static teaser, `STAFF_LIMIT_REACHED` code + interceptor; **freeze pre-blocking:** `tierFreeze` on settings/services/closures write forms, invite-staff tier+freeze gate, add-salon count gate, staff-frozen console lock, `FrozenBannerComponent`, customer slug `isFrozen` (hide barbers, disable join) |
| 9 ✅ | **Web Push:** `PushService` over `SwPush` + `/push/*` (vapid-key, subscribe, unsubscribe), contextual permission prompt after joining a queue (`PushPromptComponent`), account notifications toggle, logout unsubscribe-before-clear ordering, notification-click deep-link via `/queues/my-entries` |
| 10 ✅ | **Salon discovery + Favourites:** homepage reworked into a paginated salon listing (`GET /salons` search/state/city filter), shared `SalonCardComponent` (slug link, auth-gated heart, `mediaUrl` pipe, placeholder image), shared `PaginationComponent` (`{data, meta}`), `FavoritesService` (root-cached, optimistic toggle, `/salons/:id/favorite` + `/users/me/favorites`), favourites page + nav entry, heart on salon detail page |
| 11 ✅ | **Marketing & legal site:** `/pricing`, `/about`, `/contact` (logs values — API TODO), `/privacy`, `/terms` (sticky section nav), `PublicFooterComponent`, `CookieConsentComponent` (accept-all/reject-all, once per browser), forgot/reset password flow, verify-email banner + landing, password show/hide directive |

---

## Post-MVP Backlog (in intended order)

Push subscribe/unsubscribe (Phase 9) and forgot/reset password (Phase 11) shipped, so they're gone from this list. What remains:

1. **Notifications inbox polish:** full inbox page beyond the current invite-surfacing, unread badge, mark read / mark all, live socket `notification$` toasts. (Push *delivery* is done; this is the in-app inbox UX.)
2. **Booking & appointments:** availability slot picker, book/cancel flows, my-appointments page (needs the backend's customer-appointments listing route).
3. ~~**Analytics dashboard (Tier 2)**~~ — **shipped**, not a scaffold: `AnalyticsComponent` (`/salons/:salonId/analytics`, tier-gated) renders real `ng2-charts`/`chart.js` visualizations — a bar chart (daily served/no-shows/cancelled trends) and a pie chart (service breakdown) — plus a 7d/30d/90d date-range selector and staff sort options, all backed by `AnalyticsService`. Removed from this list.
4. **Full anonymous public access:** remove guards from `/s/:slug` for truly anonymous (no guest token) browsing; the routes and card links are already slug-stable, so this removes guards rather than moving pages.
5. **Billing polish:** real payment provider (current provider is a dummy — `checkout` returns a fake reference, `verify` always succeeds; the flow is provider-ready), and surfacing a scheduled downgrade/cancel on billing-page *reload* (needs `pendingTier`/`endsAt` — now on `EffectiveAccessDto` and wired, verify end-to-end).
6. **Contact form API:** `ContactComponent.submit()` currently logs the payload (single TODO seam) — wire the real endpoint when it exists.
7. **Geolocation location-default:** built (`GeoLocationService`, BigDataCloud reverse-geocode) but **disabled** — IP-based accuracy resolves to the nearest ISP hub, not the visitor's city. Re-enable behind a real GPS/permission story or a better provider.
8. **Smaller deferrals:** staff self-editing of schedules, i18n, e2e suite, full AXE pass on all public flows. (Profile editing and active-visit surfacing shipped — `EditProfileComponent` at `/account/edit-profile`, `MyVisitsComponent` on the customer dashboard — so both are gone from this list; a dedicated past-visit-history page is not yet built.)

### Known FIXMEs in code
- `session-init.ts` — cold-start redirect (guest→queue / user→dashboard) fires only on a fresh navigation, gated via the Navigation Timing API (`nav.type !== 'reload'`) so a refresh at `/` doesn't bounce. Documented tradeoff: redirecting from the app initializer is timing-sensitive; a post-bootstrap approach (guard/ngOnInit) wipes `sessionStorage` via trivial-history `pushState→replaceState`.
- Salon-switch (`top-bar`/`mobile-top-bar`) bounces through `/dashboard` to force teardown — replace with `runGuardsAndResolvers` or a dedicated salon-switch event.
- STAFF service-assignment route is blocked rather than path-scoped — the "my services" sub-path gap is noted for a later split.

---

## Coverage Check vs Backend

- Auth (register/login/refresh/verify/resend) → Auth feature + interceptors + session init
- Guest auth (FlexAuthGuard routes) → GuestHttpService; guest socket via token fallback in QueueSocketService
- Per-salon roles → MembershipStore + salonRoleGuard + three directives
- `/salons/mine` → Dashboard
- Org-owner authority → orgOwnerGuard + Organization feature
- Tiers + downgrade freeze + `SALON_FROZEN`/`STAFF_LIMIT_REACHED` → tierGuard + `*requiresTier` + `tierFreeze` + pre-blocking gates + `BillingService`
- Verified-email → **not gated** (backend never applies the guard); soft banner nudge only
- Salons (slug, settings, address, timezone, delete + cascades) → Salons feature
- Enriched public slug payload → Visit feature (both shells)
- Staff lifecycle (invite → claim → accept/decline → role → transfer → remove) → Staff feature + /notifications
- `GET /salons/:salonId/staff` → `{ staff, queueId }[]` — console link resolves without extra request
- Services + StaffService join + default service → Services feature
- Schedules + Closures → Schedules/Closures features
- Queue timeline + `servedAt` → live countdown in console + visit; `GET /queues/:queueId` for status
- `GET /queues/guest-entries` → `GuestEntryValidatorService.validate()` on guest shell mount
- `GET /queues/my-entries` → `SalonVisitService._loadInitialTimeline` fallback for auth users whose guest store was cleared
- Walk-in `guestToken` in response → stored in `GuestStore` at join time
- Media (Cloudinary, galleries, reorder) → shared media components; `mediaUrl` pipe resolves relative dev paths against `apiBaseUrl`
- WebSocket contract (auth payload, rooms, `queueTimeline`, reconnect re-join) → QueueSocketService
- Error envelope + stable codes + requestId → core/errors + interceptor
- /v1 versioning + no-hardcoded-URLs → environment configuration discipline
- Subscription (`GET .../subscription/me`, checkout, verify, downgrade, cancel) → `BillingService` + billing page; effective access (tier/status/limits/pendingTier/endsAt) via `EffectiveAccessDto`
- Downgrade freeze across the board (`SALON_FROZEN`, `STAFF_LIMIT_REACHED`, `TIER_REQUIRED`, `SALON_LIMIT_REACHED`) → `tierFreeze` directive + pre-blocking gates + `FrozenBannerComponent` + central interceptor handling; customer-side `isFrozen` on the slug payload hides join
- Web push (`GET /push/vapid-public-key`, `POST`/`DELETE /push/subscribe`) → `PushService` over `SwPush`; notification-click deep-link resolves via `GET /queues/my-entries`
- Salon listing (`GET /salons` — state/city/search/page/limit, `{data, meta}`) → homepage `SalonListingService` + `SalonCardComponent` + `PaginationComponent`
- Favourites (`POST`/`DELETE /salons/:salonId/favorite`, `GET /users/me/favorites`) → root-cached `FavoritesService`, optimistic toggle, favourites page
- Forgot/reset password (`POST /auth/forgot-password`, `/auth/reset-password`) → auth feature; verify-email (`/auth/verify-email`, resend) → banner + landing
