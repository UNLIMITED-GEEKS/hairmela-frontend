# HairMela Frontend Plan (Angular)

> Companion to the HairMela Backend Plan. The backend is fully built (Phases 1–9 ✅), so frontend phasing is ordered by frontend dependency, not backend availability. All API paths in this document are served under the backend's **/v1** prefix (omitted in tables for readability, exactly as in the backend plan).

## MVP Scope

The MVP is the **walk-in queue product**: salon owners set up their salon, staff, services, and hours; customers sign in (or browse as a guest), join a barber's line, and watch their position live. Four capability groups are explicitly post-MVP: **booking/appointments**, **notifications + web push**, **full anonymous public access + analytics**, and **forgot/reset password**. Auth in the MVP is login + signup only.

**Guest access is live in MVP.** Unauthenticated visitors can visit `/g/s/:slug`, choose a barber, and join the queue without an account. The backend issues a short-lived guest JWT that is stored in `localStorage` under `hairmela_guest`. Guests can track their position and add party members. When they register, the guest token is cleared and their entry persists on the backend.

**Email verification is deferred to post-MVP.** The backend's `@RequiresVerifiedEmail` decorator is not applied to any route. On the frontend: do not show the `VerifyEmailPrompt`, do not gate any action on `emailVerified`, do not handle `EMAIL_NOT_VERIFIED` errors. The `/verify-email` landing page still ships so the emailed link has somewhere to land.

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

Available in both the auth shell (`/s/:slug`) and guest shell (`/g/s/:slug`). Same four screens.

**Screen 1 — Salon landing page**
- Salon avatar/photo at top left + salon name prominently below
- Short description line
- Barber cards in a row, each showing: barber name + availability badge (green "Available" / red "Unavailable")
- Tapping a barber card navigates to that barber's queue flow

**Screen 2 — Choose Service**
- Title: "Choose Service"
- Scrollable list of services, each row: service name + duration
- Selected service highlighted in blue
- Two buttons at the bottom: "Join queue" | "Back"

**Screen 3 — Position in line (MyPositionComponent)**
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

**Screen 4 — Live queue view (`/s/:slug/q/:queueId`)**
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
| `MobileTopBarComponent` | `sheetOpen`, `salons`, `activeSalonId`, emits `sheetToggle` | Mobile only. Shows salon switcher when `activeSalon` present; else shows logo + "HairMela" text. `<ng-content>` slot holds the `MobileSheetComponent` |
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
| `@RequiresVerifiedEmail` | **deferred post-MVP; guard not applied on backend** | — |
| `@ActiveSalon` (downgrade freeze) | `tierFreeze` directive + frozen banner + `SALON_FROZEN` handler | `isFrozen` from `/salons/:salonId/me` |
| Error envelope + stable codes | `ApiError` type + error interceptor branching on `code` | `core/errors` |
| Pagination meta | Generated `PaginatedResponse` models + shared `Pagination` component | generated client |
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
│   │   └── session-init.ts          ← app initializer: silent refresh → /auth/me → hydrate; _loaded flag prevents double-run
│   ├── guest/
│   │   ├── guest-store.ts           ← localStorage key `hairmela_guest` — token + entries[] + lastPath
│   │   ├── guest-http.service.ts    ← manual HttpClient with guest Bearer header for FlexAuthGuard routes (leaveQueue, addMembers, getGuestEntries)
│   │   └── guest-entry-validator.service.ts ← called on GuestShell mount: GET /queues/guest-entries → syncEntries()
│   ├── queue/
│   │   └── active-entry.store.ts    ← unified entry persistence; delegates to GuestStore (guest) or localStorage key `hairmela_active_entries` (auth)
│   ├── salon-context/
│   │   ├── salon-context.service.ts ← derives active salonId from route params; exposes membership signal
│   │   ├── membership.store.ts      ← Map cache of GET /salons/:salonId/me; getMembership() async, getCached() sync
│   │   └── membership.types.ts      ← SalonRole enum + Membership interface
│   ├── guards/
│   │   ├── auth.guard.ts            ← authenticated → pass; refresh token → /login+returnUrl; /s/* URL → /g/s/*; guest token → /g/queues; else → /login
│   │   ├── guest.guard.ts           ← JWT-authenticated → /dashboard; guest-token users and unauthenticated → pass
│   │   ├── guest-shell.guard.ts     ← JWT-authenticated → /; everyone else → pass
│   │   ├── salon-role.guard.ts
│   │   ├── org-owner.guard.ts
│   │   └── tier.guard.ts
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
│   ├── toast/
│   │   ├── toast.service.ts
│   │   └── toast.component.ts
│   └── cache-registry.service.ts    ← Clearable interface + registry; AuthService calls clearAll() on logout
│
├── shared/
│   ├── directives/
│   │   ├── has-role.directive.ts
│   │   ├── requires-tier.directive.ts
│   │   └── tier-freeze.directive.ts
│   └── components/
│       ├── shells/
│       │   ├── public-shell/        ← PublicShellComponent: PublicNavComponent + router-outlet; navItems: Sign In (auth), Sign Up (cta)
│       │   ├── auth-shell/          ← AuthShellComponent: Sidebar + TopBar + MobileTopBar + MobileSheet + BottomNav; loads InvitesService + DashboardService on init
│       │   ├── guest-shell/         ← GuestShellComponent: same layout as auth shell; showLogout=false, showUserAvatar=false; validates guest entries on init; tracks lastPath
│       │   ├── sidebar/             ← desktop only (hidden md:flex); collapsible (hm_sidebar_collapsed in localStorage); salon controls section driven by membership input; showLogout input
│       │   ├── top-bar/             ← desktop only; salon switcher dropdown; showUserAvatar input
│       │   ├── mobile-top-bar/      ← mobile only; salon switcher when activeSalon present, else logo+text link; ng-content slot for MobileSheet
│       │   ├── mobile-sheet/        ← slide-up drawer; salon controls section driven by membership input; closed output
│       │   ├── bottom-nav/          ← mobile only (flex md:hidden); bottomNav:true items only; active tab via routerLinkActive template var → text-primary + bold label + dot
│       │   ├── public-nav/          ← desktop pill nav + mobile expandable; logo+"HairMela" links to / in both viewports
│       │   ├── nav-icon/            ← renders SVG icon by name string
│       │   └── nav-item.types.ts    ← NavItem + NavIcon union type
│       ├── confirm-dialog/
│       ├── connection-banner/
│       ├── image-uploader/
│       ├── gallery/
│       ├── avatar/
│       ├── screen-layout/
│       └── skeleton/
│
├── marketing/                       ← public marketing pages (NOT under features/)
│   ├── landing/                     ← LandingComponent — served at /
│   └── privacy/                     ← PrivacyComponent — served at /privacy
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
    │   │   └── customer-dashboard.component.ts/.html
    │   ├── salon/                           ← exists on disk but not rendered by DashboardComponent
    │   │   ├── salon-dashboard.component.ts/.html
    │   │   ├── my-salons-list/
    │   │   └── pending-invites/             ← PendingInvitesComponent — used by salon-dashboard (not by dashboard root)
    │   └── shared/
    │       └── no-salons-empty-state/
    ├── queues/
    │   ├── auth-queues/             ← AuthQueuesComponent at /queues — reads ActiveEntryStore (auth key); navigates to /s/:salonSlug/q/:queueId/position
    │   └── guest-queues/            ← GuestQueuesComponent at /g/queues — reads ActiveEntryStore (guest key); navigates to /g/s/:salonSlug/q/:queueId/position
    ├── notifications/               ← NotificationsComponent at /notifications — wraps PendingInvitesComponent
    ├── organization/
    ├── salons/
    ├── staff/
    ├── services/
    ├── schedules/
    ├── closures/
    ├── queue/           (staff console — QueueShellComponent + CurrentClientComponent + QueueListComponent)
    ├── visit/           (SalonShellComponent provides SalonVisitService; child routes shared by auth + guest shells via visitRoutes)
    └── account/
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

### CacheRegistry (`core/cache-registry.service.ts`)
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
| `orgOwnerGuard` | User owns `:orgId` | `/org/*` |
| `tierGuard` | `membership.tier >= route.data.requiredTier` → pass; else redirect to plan explainer | tier-gated routes (post-MVP consumers) |

---

## Directives (template-level control)

**`*hasRole`** — structural; renders content only if the active-salon membership role is in the list. Reads `SalonContextService`.

**`*requiresTier`** — default mode **lock**: render disabled with a lock icon + "Upgrade to enable" nudge. Reads `membership().tier`.

**`tierFreeze`** (attribute) — when `membership().isFrozen`, wrapped controls render read-only. Enforcement is server-side; `SALON_FROZEN` handled centrally if a frozen action slips through.

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
| `EMAIL_NOT_VERIFIED` | **not handled in MVP** |
| `VALIDATION_FAILED` | *local:* map `details` onto form controls; toast fallback |
| `TIER_REQUIRED` | Upgrade nudge |
| `SALON_FROZEN` | Frozen-salon prompt |
| `SALON_LIMIT_REACHED` | *local:* upgrade nudge on Create Salon |
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
- Every live view (console + customer visit) runs a single `setInterval` ticking a `_tick` signal every second
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
- `joinQueue()` — on success stores `res.body.guestToken` in `GuestStore` (if present) and the entry in `ActiveEntryStore`. Immediately re-fetches timeline before navigating.
- `leaveQueue()` / `addMembers()` — route to `GuestHttpService` when `GuestStore.hasToken()`, otherwise to the generated client. Both paths call `_loadInitialTimeline` on success to immediately refresh the party list.
- `selectBarber()` — checks `ActiveEntryStore` for an existing entry; navigates to `/position` if already in queue, otherwise to `/join`. Unauthenticated + no guest token → `/register` with returnUrl.

---

## Queues Pages (`features/queues/`)

Two components sharing the same visual design but different navigation targets:

| Component | Route | Data source | Navigate to |
|---|---|---|---|
| `AuthQueuesComponent` | `/queues` | `myEntriesControllerGetMyEntries` (REST) — live list from backend; `ActiveEntryStore.getForQueue()` for `salonSlug` | `/s/:salonSlug/q/:queueId/position` |
| `GuestQueuesComponent` | `/g/queues` | `GuestHttpService.getGuestEntries()` (REST with guest token) — live list from backend; `ActiveEntryStore.getForQueue()` for `salonSlug` | `/g/s/:salonSlug/q/:queueId/position` |

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
**Routes (inside public shell):** `/login`, `/register`, `/verify-email`

| Component | Endpoint |
|---|---|
| `LoginComponent` | POST /auth/login |
| `RegisterComponent` | POST /auth/register — clears guest token on success |
| `VerifyEmailComponent` | POST /auth/verify-email |

**Guards:** `guestGuard` on login/register; verify-email is public.

### Notifications — `features/notifications/`
**Route:** `/notifications` — wraps `PendingInvitesComponent`. **Guards:** `authGuard`.

### Organization — `features/organization/`
**Routes:** `/org/:orgId`, `/org/:orgId/settings`, `/org/:orgId/plan`

| Component | Endpoint |
|---|---|
| `OrgOverviewComponent` | GET /organizations/:orgId |
| `OrgSettingsComponent` | PATCH /organizations/:orgId |
| `PlanExplainerComponent` | — (static) |

**Guards:** `authGuard + orgOwnerGuard`.

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

### Queue (staff console) — `features/queue/`
**Route:** `/salons/:salonId/queues/:queueId/console`

`QueueShellComponent` provides `QueueConsoleService` via `providers: [QueueConsoleService]` (scoped to the shell — NOT `providedIn: 'root'`). Two child routes: `''` → `CurrentClientComponent`, `'queue'` → `QueueListComponent`. `QueueShellComponent.ngOnInit()` calls `console.init(salonId, queueId)`; `ngOnDestroy` calls `console.destroy(queueId)`.

| Responsibility | Endpoint / Socket |
|---|---|
| Initial timeline | GET /queues/:queueId/timeline |
| Queue status + staff services | GET /queues/:queueId → `switchMap` → GET /salons/:salonId/staff/:staffId/services (chained in `_loadQueueStatus`) |
| Live timeline | `watchQueueAsStaff` + `queueTimeline$` |
| Live stopwatch | `timerFromServedAt` computed from `servedAt` |
| Live wait times | `liveWait(entryId)` / `memberWait(memberId)` from computed maps |
| Set status | PATCH .../status |
| Call next | POST .../call-next (409 → resolve-flow toast) |
| Complete member | PATCH .../members/:memberId/complete |
| Complete all | POST .../entries/:entryId/complete-all |
| No-show | PATCH .../entries/:entryId/no-show |
| Cancel entry | DELETE .../entries/:entryId |
| Extend member | PATCH .../members/:memberId/extend |

**Guards:** `salonRoleGuard(OWNER, ADMIN, STAFF)`.

### Visit (customer-facing) — `features/visit/`

**Routes** — mounted under BOTH auth shell (`/s/:slug`) and guest shell (`/g/s/:slug`). Same `visitRoutes` lazy module, distinguished by `data: { shellPrefix }`.

- `/s/:slug` / `/g/s/:slug` → `SalonLandingComponent`
- `q/:queueId` → `LiveQueueComponent`
- `q/:queueId/join` → `JoinQueueComponent`
- `q/:queueId/position` → `MyPositionComponent`

`SalonShellComponent` injects `SalonVisitService` (which is `providedIn: 'root'`) and on `ngOnInit` calls `visit.init(slug, shellPrefix)` where `shellPrefix` is read from `route.snapshot.data['shellPrefix']`. On `ngOnDestroy` calls `visit.destroy()` to reset all signals and clear watched queues.

| Responsibility | Endpoint / Socket |
|---|---|
| Salon + staff data | GET /salons/slug/:slug |
| Services | GET /salons/:salonId/services |
| Queue status | GET /queues/:queueId |
| Initial timeline | GET /queues/:queueId/timeline (+ re-fetch after join) |
| Live timeline | `watchQueue` + `queueTimeline$` |
| Join queue | POST .../walk-in — response includes `{ entry, guestToken? }` |
| Leave queue | `GuestHttpService.leaveQueue` (guest) or generated client (auth) |
| Add members | `GuestHttpService.addMembers` (guest) or generated client (auth) — re-fetches timeline on success |
| My active entry | `ActiveEntryStore` (unified over guest/auth localStorage) |
| Stale entry guard | On each timeline update: validate stored `entryId`; if absent → purge + clear `activeEntry` |
| Called banner | Auto-shown 5s when entry flips to SERVING — suppressed on initial socket reply via `_socketInitialReceived` Set |
| Service complete | `timelineLoaded` must be `true` before `MyPositionComponent` evaluates; prevents false positive on reload |

**Guards:** `authGuard` for auth shell; `guestShellGuard` for guest shell (`/g/*`).

### Account — `features/account/`
**Route:** `/account` — read-only profile from `CurrentUserStore` (no extra API call). Logout button calls `AuthService.logout()`. **Guards:** `authGuard`.

---

## Routing Map

```
/                                   public shell (PublicShellComponent)
/privacy                            public shell
/verify-email                       public shell
/login                              public shell + guestGuard
/register                           public shell + guestGuard

/g                                  guest shell (GuestShellComponent) + guestShellGuard
  /g/queues                         GuestQueuesComponent
  /g/s/:slug                        visitRoutes (shellPrefix = '/g')
    /g/s/:slug/q/:queueId
    /g/s/:slug/q/:queueId/join
    /g/s/:slug/q/:queueId/position

/                                   auth shell (AuthShellComponent) + authGuard
  /dashboard                        DashboardComponent
  /account                          AccountComponent
  /notifications                    NotificationsComponent
  /queues                           AuthQueuesComponent
  /s/:slug                          visitRoutes (shellPrefix = '')
    /s/:slug/q/:queueId
    /s/:slug/q/:queueId/join
    /s/:slug/q/:queueId/position
  /org/:orgId                       + orgOwnerGuard
  /org/:orgId/settings              + orgOwnerGuard
  /org/:orgId/plan                  + orgOwnerGuard
  /salons/new
  /salons/:salonId                  + salonRoleGuard(OWNER,ADMIN,STAFF)
  /salons/:salonId/settings         + salonRoleGuard(OWNER,ADMIN)
  /salons/:salonId/slug             + salonRoleGuard(OWNER)
  /salons/:salonId/share            + salonRoleGuard(OWNER,ADMIN)
  /salons/:salonId/delete           + salonRoleGuard(OWNER)
  /salons/:salonId/media            + salonRoleGuard(OWNER,ADMIN,STAFF)
  /salons/:salonId/closures         + salonRoleGuard(OWNER,ADMIN)
  /salons/:salonId/services         + salonRoleGuard(OWNER,ADMIN,STAFF)
  /salons/:salonId/services/new     + salonRoleGuard(OWNER,ADMIN)
  /salons/:salonId/services/:id/edit+ salonRoleGuard(OWNER,ADMIN)
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
- **Per-salon authorization:** `MembershipStore` behind `SalonContextService`.
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
- `environment.ts` owns `apiBaseUrl` (with `/v1`), `socketUrl`, `appBaseUrl`. No URL literals in source.

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

---

## Post-MVP Backlog (in intended order)

1. **Notifications + Push:** full inbox, unread badge, mark read/all, socket `notification$` toasts; PWA + `SwPush` subscribe/unsubscribe, contextual permission prompt, logout unsubscribe ordering
2. **Full public access + Analytics:** remove guards from `/s/:slug` routes for truly anonymous (no guest token) browsing; analytics dashboard (Tier 2)
3. **Booking & appointments:** availability slot picker, book/cancel flows, my-appointments page
4. **Auth completion & polish:** forgot password, reset password, full AXE pass
5. **Smaller deferrals:** profile editing, visit history, subscription self-service UI, staff self-editing of schedules, i18n, e2e suite

---

## Coverage Check vs Backend

- Auth (register/login/refresh/verify/resend) → Auth feature + interceptors + session init
- Guest auth (FlexAuthGuard routes) → GuestHttpService; guest socket via token fallback in QueueSocketService
- Per-salon roles → MembershipStore + salonRoleGuard + three directives
- `/salons/mine` → Dashboard
- Org-owner authority → orgOwnerGuard + Organization feature
- Tiers + downgrade freeze + `SALON_FROZEN` → tierGuard + `*requiresTier` + `tierFreeze`
- Verified-email gating → **deferred post-MVP**
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
- Media (Cloudinary, galleries, reorder) → shared media components
- WebSocket contract (auth payload, rooms, `queueTimeline`, reconnect re-join) → QueueSocketService
- Error envelope + stable codes + requestId → core/errors + interceptor
- /v1 versioning + no-hardcoded-URLs → environment configuration discipline
