# HairMela Frontend Plan (Angular)

> Companion to the HairMela Backend Plan. The backend is fully built (Phases 1–9 ✅), so frontend phasing is ordered by frontend dependency, not backend availability. All API paths in this document are served under the backend's **/v1** prefix (omitted in tables for readability, exactly as in the backend plan).

## MVP Scope

The MVP is the **walk-in queue product**: salon owners set up their salon, staff, services, and hours; customers sign in, join a barber's line, and watch their position live. Four capability groups are explicitly post-MVP and listed in the backlog at the end: **booking/appointments**, **notifications + web push**, **anonymous public access + analytics**, and **forgot/reset password**. Auth in the MVP is login + signup only.

**Email verification is deferred to post-MVP.** The backend's `@RequiresVerifiedEmail` decorator and `VerifiedEmailGuard` exist but are not applied to any route — verification is not enforced server-side. On the frontend: do not show the `VerifyEmailPrompt`, do not gate any action on `emailVerified`, and do not handle `EMAIL_NOT_VERIFIED` errors (they won't arrive). The verify-email landing page (`/verify-email`) still ships so the emailed link has somewhere to land, but it is purely informational for now.

---

## UI Reference (Designer Sketches)

These sketches are the source of truth for the two core flows. Build to match them.

---

### Barber POV — Staff Console (`/salons/:salonId/queues/:queueId/console`)

Two-panel layout side by side:

**Left panel — Current Client card**
- Header label: "Current Client"
- Large circle in the center displaying the serving client's first name prominently (e.g. "John")
- Below the name: a running timer (e.g. `45:35`) counting up from when the session started
- Below the timer: estimated finish time (e.g. `eft: 2pm`) derived from the service duration
- Two action buttons at the bottom:
  - "View Queue" — toggles to the right panel / queue list view
  - "End Session" — completes the current client (maps to Complete action on the member)

**Right panel — Queue list**
- Header: "Total Count: 7" (total waiting)
- Two column headers: "Clients on queue" | "Wait time"
- Scrollable list of waiting clients, each row: client first name + estimated wait (e.g. `4m 5s`)
- Two action buttons at the bottom:
  - "Add Queue" — reserved for future barber-side manual add; not in MVP scope
  - "Back" — returns focus to the left panel

---

### Customer POV — Visit + Join flow (`/s/:slug` → `/s/:slug/q/:queueId`)

Four screens in sequence:

**Screen 1 — Salon landing page (`/s/:slug`)**
- Salon avatar/photo at top left + salon name prominently below
- Short description line ("Barbers in sunny shop")
- Barber cards in a row, each showing: barber name + availability badge (green "Available" / red "Unavailable")
- Tapping a barber card navigates to that barber's queue flow

**Screen 2 — Choose Service**
- Title: "Choose Service"
- Scrollable list of services, each row: service name + duration (e.g. `Classic Haircuts & Fades — 45mins`)
- Selected service highlighted in blue
- Two buttons at the bottom: "Join queue" (confirms selection + joins) | "Back"

**Screen 3 — Position in line (MyEntryCard)**
- Large circle center-screen showing:
  - "Position in line" label
  - Position number large (e.g. `7`)
  - Estimated wait below (e.g. `est: 5m`) — live countdown ticking every second
- "Add Kids" button — opens party member rows (name + service picker per extra person)
- Two buttons at the bottom: "View queue" (goes to Screen 4) | "Back"

**Screen 4 — Live queue view for this barber (`/s/:slug/q/:queueId`)**
- Barber photo/avatar + name ("Dany the barber") + availability badge
- Two column headers: "Waiting" | "Estimated time"
- Scrollable queue list, each row: client label (anonymized: "Client 1", "Client 2"…) + wait time — live countdown ticking every second
- The user's own row highlighted green with label "Me"
- Two buttons at the bottom:
  - "Leave queue" (red/destructive — confirm dialog before calling DELETE)
  - "Back"

---

## Architecture Overview

**Framework:** Current Angular (standalone components — the default, never set `standalone: true`), signals, built-in control flow
**State:** Signals for view/store state; RxJS for streams (HTTP, WebSocket, refresh-token queuing, debounced inputs)
**Routing:** Lazy feature routes (`loadComponent` / `loadChildren`) + functional guards
**HTTP:** `HttpClient` with functional interceptors; **all API calls go through the generated client** — components never touch `HttpClient` directly
**API types & services:** **Generated** by `ng-openapi-gen` from the backend's `/docs-json` — never hand-mirrored
**Real-time:** `socket.io-client` wrapped in `QueueSocketService` (backend namespace `/queues`, JWT in the auth payload)
**Forms:** Typed Reactive Forms
**Styling:** Tailwind CSS utility classes; SCSS only when Tailwind genuinely cannot do it (complex keyframe animations, third-party overrides)
**Error contract:** The backend's uniform error envelope — the frontend **branches on `code`, never on `message`**

---

## Design Principle: Mirror the Backend's Control Layers

The frontend never enforces security — the backend does. The frontend mirrors each control so users only *see and attempt* what they're allowed to, and so the UI and the guards can never disagree.

| Backend control | Frontend counterpart | Data source |
|---|---|---|
| `JwtAuthGuard` | `authGuard` + jwt/refresh interceptors | `TokenStore` |
| `@SalonRoles(...)` | `salonRoleGuard` + `*hasRole` | `GET /salons/:salonId/me` via `MembershipStore` |
| `@OrgOwner` | `orgOwnerGuard` | `GET /organizations/mine` |
| `@RequiresTier(n)` | `tierGuard` + `*requiresTier` (visible-but-locked) | `tier` from `/salons/:salonId/me` |
| `@RequiresVerifiedEmail` | ~~`VerifyEmailPrompt` + `EMAIL_NOT_VERIFIED` handler~~ — **deferred post-MVP; guard not applied on backend** | — |
| `@ActiveSalon` (downgrade freeze) | `tierFreeze` directive + frozen banner + `SALON_FROZEN` handler | `isFrozen` from `/salons/:salonId/me` |
| Error envelope + stable codes | `ApiError` type + error interceptor branching on `code` | `core/errors` |
| Pagination meta | Generated `PaginatedResponse` models + shared `Pagination` component | generated client |
| WebSocket rooms & events | `QueueSocketService` typed streams | manual socket types |

The backend's own instruction is the operating rule here: the frontend must **never** infer a user's role by probing protected routes and reacting to 403s. `GET /salons/:salonId/me` returns `{ salonId, role, isStaff, canManageSalon, canManageStaff, tier, isFrozen }` with `role ∈ OWNER | ADMIN | STAFF | CUSTOMER` — one call answers "what am I here, and what does this salon's plan allow?" for guards, directives, and upgrade prompts alike.

---

## Generated API Layer (ng-openapi-gen)

The backend serves OpenAPI at `/docs-json` with the CLI plugin inferring every DTO. The frontend consumes it; nothing is typed twice.

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
- `src/app/api/**` is generated — never hand-edited, regenerated after every backend DTO change. A stale client shows up as TypeScript errors, which is the point.
- The generated `ApiConfiguration.rootUrl` is set from `environment.apiBaseUrl` in `app.config.ts` — the single place the API URL exists.
- Generated services are the only HTTP entry points. Thin feature services wrap them where orchestration is needed; components never inject generated services *and* `HttpClient` side by side.
- The generated client uses **functional API** (`fn/` directory) — import individual functions, not service classes.

**What is NOT generated (maintained by hand in `core/`):**
- `error-codes.ts` — mirror of the backend's stable code enum (small, changes rarely, breaks loudly)
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
├── app.routes.ts                    ← top-level lazy routes
├── app.component.ts                 ← shell: header, nav, toast outlet
│
├── api/                             ← GENERATED (fn/ + models/) — never edit; run npm run generate:api
│
├── core/                            ← singletons (providedIn: 'root'), loaded once
│   ├── auth/
│   │   ├── auth.service.ts          ← login, register, logout, verify/resend
│   │   ├── token.store.ts           ← access token (memory signal) + refresh token (localStorage)
│   │   ├── current-user.store.ts    ← signal<User | null> hydrated from GET /auth/me
│   │   └── session-init.ts          ← app initializer: silent refresh → /auth/me → hydrate
│   ├── salon-context/
│   │   ├── salon-context.service.ts ← active salonId from route; exposes membership signal
│   │   ├── membership.store.ts      ← per-salon cache of GET /salons/:salonId/me
│   │   └── membership.types.ts      ← SalonRole enum + Membership interface
│   ├── guards/
│   │   ├── auth.guard.ts
│   │   ├── guest.guard.ts
│   │   ├── salon-role.guard.ts
│   │   ├── org-owner.guard.ts
│   │   └── tier.guard.ts
│   ├── interceptors/
│   │   ├── jwt.interceptor.ts
│   │   ├── refresh.interceptor.ts
│   │   └── error.interceptor.ts
│   ├── errors/
│   │   ├── error-codes.ts           ← hand-maintained mirror of backend enum
│   │   └── api-error.types.ts       ← envelope type + isApiError() type guard
│   ├── socket/
│   │   ├── queue-socket.service.ts
│   │   └── socket.types.ts          ← re-exports TimelineEntryDto; CustomerCalledPayload; ConnectionState
│   └── toast/
│       ├── toast.service.ts
│       └── toast.component.ts
│
├── shared/                          ← reusable, imported per-feature
│   ├── directives/
│   │   ├── has-role.directive.ts        ← *hasRole="['OWNER','ADMIN']"
│   │   ├── requires-tier.directive.ts   ← *requiresTier="2" (lock | hide modes)
│   │   └── tier-freeze.directive.ts     ← [tierFreeze]="membership().isFrozen"
│   └── components/
│       ├── confirm-dialog/              ← ConfirmDialogService + ConfirmDialogComponent
│       ├── image-uploader/              ← file pick, client-side validate (jpeg/png/webp, ≤5 MB), multipart
│       ├── gallery/                     ← display + drag-reorder
│       └── avatar/                      ← initials fallback
│
└── features/                        ← lazy-loaded
    ├── auth/            (login, register, verify-email)
    ├── dashboard/
    │   ├── dashboard.component.ts/.html     ← shell: fetches /salons/mine, routes to salon or customer view
    │   ├── customer/
    │   │   └── customer-dashboard.component.ts/.html
    │   ├── salon/
    │   │   ├── salon-dashboard.component.ts/.html
    │   │   ├── my-salons-list/
    │   │   └── pending-invites/             ← also used by /notifications
    │   └── shared/
    │       └── no-salons-empty-state/
    ├── notifications/   (/notifications — wraps PendingInvitesComponent)
    ├── organization/
    ├── salons/
    ├── staff/
    ├── services/
    ├── schedules/
    ├── closures/
    ├── queue/           (staff console)
    ├── visit/           (customer-facing salon page at /s/:slug + join/track)
    └── account/
```

Each feature folder follows: `*.component.ts` + `*.component.html` (orchestration only). A `*.component.scss` is only added when custom CSS is genuinely needed beyond Tailwind.

---

## Core: Auth & Session

### token.store.ts
- **Access token:** in-memory signal only — never persisted. Lost on reload by design.
- **Refresh token:** `localStorage`. Trade-off stated honestly: persistent sessions require a persisted credential; the backend is a separate origin with no cookie infrastructure (stateless JWT, revocation deferred backend-side). XSS exposure is mitigated by Angular's default sanitization and by never rendering user-supplied HTML; cookie-based refresh is the post-MVP path if requirements tighten.
- Exposes `isAuthenticated` computed from access-token presence.

### session-init.ts (`provideAppInitializer`)
On boot: refresh token present → `POST /auth/refresh` → store new pair → `GET /auth/me` → hydrate `CurrentUserStore`. Any failure → clear tokens, land logged-out. The app never renders an authed shell on a dead session.

### auth.service.ts
- `login(dto)` / `register(dto)` via the generated client; on success store tokens + hydrate user. After registration: route to dashboard directly — no "verify your email" banner in MVP (email verification deferred).
- `logout()` — disconnect the socket, clear tokens + stores, navigate `/login`. There is no backend logout endpoint (stateless JWT; revocation deferred) — logout is client-side.
- `verifyEmail(token)` → `POST /auth/verify-email` (token in the **body**, taken from the landing page's query param); `resendVerification()` → `POST /auth/resend-verification`.

### current-user.store.ts
`signal<User | null>` from `GET /auth/me`. `emailVerified` is available on the type but not acted on in MVP — no verify prompt, no gating.

### membership.store.ts + salon-context.service.ts
- `getMembership(salonId)`: returns cached `{ role, isStaff, canManageSalon, canManageStaff, tier, isFrozen }` or fetches `GET /salons/:salonId/me`. This is the **only** role/tier-discovery mechanism in the app.
- Cache invalidation: on accept/decline invite, role change, ownership transfer, and logout. One plain `Map<salonId, Membership>` — no LRU machinery.
- `SalonContextService` derives the active `salonId` from the route and exposes the active membership as a signal — guards and the three directives all read from here, so route protection and template state share one source and can never disagree.

---

## Guards (functional)

| Guard | Logic | Used on |
|---|---|---|
| `authGuard` | No valid session → store attempted URL → redirect `/login` (return-url honored after login) | all authenticated routes |
| `guestGuard` | Authenticated → redirect `/dashboard` | `/login`, `/register` |
| `salonRoleGuard` | Reads `:salonId`, awaits `MembershipStore.getMembership()`, checks `route.data.roles`. `CUSTOMER` or insufficient role → redirect to the salon's visit page or dashboard | salon management routes |
| `orgOwnerGuard` | User owns `:orgId` (via `GET /organizations/mine`, cached) | `/org/*` |
| `tierGuard` | `membership.tier >= route.data.requiredTier` → pass; else redirect to the plan explainer. Built; its route consumers (analytics, booking) arrive post-MVP | tier-gated routes (post-MVP) |

Guards are async-safe: they await the membership fetch (first visit to a salon) rather than reading a possibly-empty cache.

---

## Directives (template-level control)

**`*hasRole`** — structural; renders content only if the active-salon membership role is in the list. Reads `SalonContextService`.
```html
<button *hasRole="['OWNER','ADMIN']">Invite staff</button>
```

**`*requiresTier`** — default mode **lock**: render disabled with a lock icon + "Upgrade to enable" nudge. `mode: 'hide'` for the rare case a locked control would confuse. Reads `membership().tier`.

**`tierFreeze`** (attribute) — when `membership().isFrozen`, wrapped controls render read-only with a "frozen — upgrade to edit" overlay. Enforcement is server-side; this is honest UI, with `SALON_FROZEN` handled centrally if a frozen action slips through anyway.

---

## Interceptors (functional, ordered: jwt → refresh → error)

**`jwtInterceptor`** — attaches `Authorization: Bearer <access>` to requests targeting `environment.apiBaseUrl`, skipping `/auth/login`, `/auth/register`, `/auth/refresh`, and public reads.

**`refreshInterceptor`** — on 401 with code `TOKEN_EXPIRED`: single-flight refresh (one `POST /auth/refresh` shared by all concurrent 401s via RxJS), queue and retry the originals with the new access token. Refresh fails or code is `TOKEN_INVALID` → full logout. Never retries the refresh call itself.

**`errorInterceptor`** — parses the envelope into `ApiError` (with an `isApiError` guard for non-envelope failures like network drops), branches on `code` per the table below, and rethrows a typed error so features can add flow-specific handling. Unknown/500 errors: generic toast **including the `requestId`** so a user report can be matched to backend logs.

---

## Error Handling Convention (code → UI behavior)

The frontend branches on `code`, never on `message` (backend contract). Central handling lives in the interceptor; rows marked *local* are handled by the owning feature.

| Code(s) | Behavior |
|---|---|
| `TOKEN_EXPIRED` | Silent refresh + retry (refresh interceptor) |
| `TOKEN_INVALID` | Logout + redirect to login |
| `INVALID_CREDENTIALS` | *local:* inline form error on login |
| `EMAIL_ALREADY_REGISTERED` | *local:* inline error on register, link to login |
| `EMAIL_NOT_VERIFIED` | **not handled in MVP; backend guard not applied** |
| `VALIDATION_FAILED` | *local:* map `details[{field, constraint}]` onto form controls; toast fallback |
| `TIER_REQUIRED` | Upgrade nudge — owner sees the plan screen link, non-owner sees "ask the owner" |
| `SALON_FROZEN` | Frozen-salon prompt: "this salon is over the plan's limit — upgrade to reactivate" (owner) / informational notice (others) |
| `SALON_LIMIT_REACHED` | *local:* upgrade nudge on Create Salon |
| `SALON_SLUG_TAKEN`, `SERVICE_NAME_TAKEN`, `STAFF_ALREADY_INVITED` | *local:* inline field errors |
| `CANNOT_REMOVE_OWNER` | Toast directing to the Transfer Ownership flow |
| `PARTY_TOO_LARGE` | *local:* inline error on join form (form also pre-caps at `settings.maxPartySize`) |
| `QUEUE_NOT_OPEN`, `QUEUE_ALREADY_CLOSED` | Toast + refresh queue state; join CTA disabled |
| `ENTRY_NOT_WAITING`, `ENTRY_ALREADY_SERVING`, `MEMBER_NOT_SERVING`, `ENTRY_NOT_FOUND`, `MEMBER_NOT_FOUND` | *local (console):* "resolve the current customer first" toast + timeline re-sync |
| `*_NOT_FOUND` (salon/org/staff/service/queue/notification) | Toast + navigate to the nearest safe parent view |
| Network error / non-envelope | "You appear to be offline" toast; queue views show the socket's reconnecting state |

---

## WebSocket Client (QueueSocketService)

Wraps `socket.io-client` against the backend's `/queues` namespace.

**Connection:**
- `io(environment.socketUrl + '/queues', { auth: { token } })` — JWT in the **auth payload**, never the query string.
- On login/logout the socket reconnects/disconnects.

**API:**

| Member | Purpose |
|---|---|
| `connect()` / `disconnect()` | Lifecycle; reads token from `TokenStore` at connect time |
| `watchQueue(queueId)` | emit `joinQueue` — public room; server immediately replies with the current `queueTimeline` |
| `watchQueueAsStaff(queueId)` | emit `joinQueueStaff` (token re-verified server-side) |
| `unwatchQueue(queueId)` | emit `leaveQueue` |
| `queueTimeline$(queueId)` | Observable of `TimelineEntryDto[]` — the full recomputed timeline on every `queue.updated` |
| `customerCalled$(queueId)` | room-level called broadcast (anonymized) |
| `connectionState$` | connected / reconnecting — surfaced as a banner on live views |

**Reconnect discipline:** on reconnect, re-emit `joinQueue`/`joinQueueStaff` for every watched queue. The immediate `queueTimeline` reply doubles as state resync after a connection gap.

---

## Live Wait Time Countdown

**The core product promise:** wait times tick down in real time for every connected customer — no refresh, no polling.

**How it works:**
- `TimelineMemberDto.servedAt: string | null` — ISO timestamp stamped by the backend when a member transitions to SERVING
- Every live view (console + customer visit) runs a single `setInterval` ticking a `_tick` signal every second
- `_elapsedSeconds` is a `computed()` that reads `_tick` and calculates `(Date.now() - new Date(servedAt).getTime()) / 1000`
- `liveWaitMinutes` is a `computed()` `Map<entryId, number>` that subtracts elapsed minutes from each entry's `estimatedWaitMinutes`
- All displayed wait times call `liveWait(entryId)` which formats from this map
- The barber's stopwatch (`timerFromServedAt`) derives from the same `servedAt` — accurate on console reload

**Why this works for all clients simultaneously:** every browser connected to the queue room receives the same `queueTimeline` snapshot (including `servedAt`) when the barber calls next. Each browser independently runs the countdown arithmetic from that shared timestamp — they all tick in sync without any additional socket events.

---

## Feature Modules

### Auth — `features/auth/`

**Routes:** `/login`, `/register`, `/verify-email`

| Component | Endpoint |
|---|---|
| `LoginComponent` | POST /auth/login |
| `RegisterComponent` | POST /auth/register |
| `VerifyEmailComponent` | POST /auth/verify-email |

**Guards:** `guestGuard` on login/register; verify-email is public.

### Dashboard — `features/dashboard/`

**Route:** `/dashboard`

Shell (`DashboardComponent`) calls `GET /salons/mine` once. Empty result → `CustomerDashboardComponent`. Non-empty → `SalonDashboardComponent`.

| Component | Endpoint |
|---|---|
| `DashboardComponent` | GET /salons/mine |
| `SalonDashboardComponent` | — (renders MySalonsList) |
| `MySalonsListComponent` | GET /salons/mine → `{ salon, role }[]` |
| `PendingInvitesComponent` | GET /notifications + staff accept/decline — **also used by `/notifications`** |
| `CustomerDashboardComponent` | — |
| `NoSalonsEmptyStateComponent` | — |

**Guards:** `authGuard`.

### Notifications — `features/notifications/`

**Route:** `/notifications`

`NotificationsComponent` wraps `PendingInvitesComponent`. Accessible from the bell icon in the app shell. After accept/decline, navigates to `/dashboard`.

**Guards:** `authGuard`.

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
| `SalonShareComponent` | — (client-side QR via `qrcode` npm package → `mod.default.toDataURL`) |
| `DeleteSalonComponent` | DELETE /salons/:salonId |
| `SalonMediaComponent` | GET/POST/DELETE/PATCH /salons/:salonId/media |

**QR note:** `qrcode` is a CJS package. In the production ESM bundle the API lands under `mod.default`, not at the top level. Always resolve as: `const toDataURL = (mod.default as ...).toDataURL ?? mod.toDataURL`.

**Guards:** `/salons/new` = `authGuard` only. `:salonId` = `salonRoleGuard(OWNER, ADMIN, STAFF)`; settings/slug/delete additionally scoped by role data.

### Staff — `features/staff/`

**Routes:** `/salons/:salonId/staff`, `/salons/:salonId/staff/:staffId`, `/salons/:salonId/staff/:staffId/media`, `/salons/:salonId/staff/:staffId/schedules`

| Component | Endpoint |
|---|---|
| `StaffListComponent` | GET /salons/:salonId/staff → `{ staff, queueId }[]` |
| `InviteStaffComponent` | POST .../staff/invite |
| `StaffDetailComponent` | PATCH .../staff/:staffId/role, DELETE .../staff/:staffId, PATCH .../staff/transfer-ownership |
| `StaffMediaComponent` | GET/POST/DELETE/PATCH .../staff/:staffId/media |
| `PendingInvitesComponent` | POST .../staff/accept, POST .../staff/decline |

**Guards:** management = `salonRoleGuard(OWNER, ADMIN)`; accept/decline = `authGuard` only.

### Services — `features/services/`

**Routes:** `/salons/:salonId/services`, `/salons/:salonId/services/new`, `/salons/:salonId/services/:serviceId/edit`, `/salons/:salonId/staff/:staffId/services`

| Component | Endpoint |
|---|---|
| `ServiceListComponent` | GET /salons/:salonId/services (`publicServicesControllerFindBySalon`) |
| `ServiceFormComponent` | POST + PATCH .../services; prefills via `publicServicesControllerFindBySalon` |
| `StaffServiceAssignComponent` | `forkJoin` of: `publicServicesControllerFindBySalon`, `staffServicesControllerGetStaffServices`, `staffControllerFindAll`; POST/DELETE .../staff/:staffId/services(/:serviceId), PATCH .../default-service |

**Model note:** `GET .../staff/:staffId/services` returns `StaffService[]` — shape `{ id, serviceId, staffId, service: Service, staff: SalonStaff }`. Service details are nested under `.service`; default service ID is at `SalonStaff.defaultServiceId` fetched via the staff list.

**Guards:** catalog CRUD = `(OWNER, ADMIN)`; assignment = `(OWNER, ADMIN, STAFF)`.

### Schedules — `features/schedules/`

**Route:** `/salons/:salonId/staff/:staffId/schedules` (linked from `StaffDetailComponent`)

| Component | Endpoint |
|---|---|
| `WeeklyScheduleComponent` | GET/POST/PATCH/DELETE .../schedules(/:scheduleId) |

**Guards:** `salonRoleGuard(OWNER, ADMIN)`.

### Closures — `features/closures/`

**Route:** `/salons/:salonId/closures` (child of salon routes)

| Component | Endpoint |
|---|---|
| `ClosuresComponent` | GET/POST/DELETE .../closures + .../staff/:staffId/closures |

**Guards:** `salonRoleGuard(OWNER, ADMIN)`.

### Queue (staff console) — `features/queue/`

**Route:** `/salons/:salonId/queues/:queueId/console`

`QueueConsoleComponent` — single component, two-panel layout (current client / queue list).

| Responsibility | Endpoint / Socket |
|---|---|
| Initial timeline | GET /queues/:queueId/timeline (`publicQueueControllerGetTimeline`) |
| Queue status | GET /queues/:queueId (`publicQueueControllerGetQueue`) |
| Live timeline | `watchQueueAsStaff` + `queueTimeline$` |
| Live stopwatch | `timerFromServedAt` computed from `servedAt` on the serving member — ticks every second via `_tick` signal |
| Live wait times (queue panel) | `liveWait(entryId)` from `liveWaitMinutes` computed map — same `_tick` signal |
| Set status | PATCH .../status |
| Call next | POST .../call-next (409 → resolve-flow toast) |
| Complete member | PATCH .../members/:memberId/complete |
| No-show | PATCH .../entries/:entryId/no-show |
| Cancel entry | DELETE .../entries/:entryId |
| Extend member | PATCH .../members/:memberId/extend |

**Guards:** `salonRoleGuard(OWNER, ADMIN, STAFF)`.

### Visit (customer-facing) — `features/visit/`

**Routes:** `/s/:slug`, `/s/:slug/q/:queueId`

Both routes load the same `SalonVisitComponent`. The component manages all screens via a `screen` signal (`landing` → `choose-service` → `live-queue`). No separate child components for join/position/leave — all inline.

| Responsibility | Endpoint / Socket |
|---|---|
| Salon + staff data | GET /salons/slug/:slug (`publicSalonsControllerFindBySlug`) |
| Services | GET /salons/:salonId/services (`publicServicesControllerFindBySalon`) |
| Queue status | GET /queues/:queueId (`publicQueueControllerGetQueue`) |
| Initial timeline | GET /queues/:queueId/timeline (`publicQueueControllerGetTimeline`) |
| Live timeline | `watchQueue` + `queueTimeline$` |
| Live wait times | `liveWait(entryId)` from `liveWaitMinutes` computed map — same `_tick` pattern as console |
| Join queue | POST /salons/:salonId/queues/:queueId/walk-in (`walkInControllerJoinQueue`) |
| Leave queue | DELETE .../walk-in/:entryId (`walkInControllerLeaveQueue`) |
| My active entry | `{queueId, entryId, salonId}[]` in `localStorage` key `hairmela_active_entries` |
| Stale entry guard | On each timeline update, validate stored `entryId` is present; if absent, purge localStorage and reset to `choose-service` |
| Called banner | Auto-shown 5s when entry members flip to SERVING in the timeline |

**Guards:** `authGuard` (MVP — removed when public access ships).

### Account — `features/account/`

**Route:** `/account`

`AccountComponent` — read-only profile. Shows initials avatar, first/last name, email, phone, member-since date. Logout button calls `AuthService.logout()`. Data comes from `CurrentUserStore` (populated at session init by `GET /auth/me`) — no additional API call on mount.

**Guards:** `authGuard`.

---

## Routing Map (actual implementation)

```
/login                                         guestGuard
/register                                      guestGuard
/verify-email                                  public

/dashboard                                     authGuard
/account                                       authGuard
/notifications                                 authGuard

/org/:orgId/**                                 authGuard + orgOwnerGuard

/salons/new                                    authGuard
/salons/:salonId                               authGuard + salonRoleGuard(OWNER, ADMIN, STAFF)
/salons/:salonId/settings                      authGuard + salonRoleGuard(OWNER, ADMIN)
/salons/:salonId/slug                          authGuard + salonRoleGuard(OWNER)
/salons/:salonId/share                         authGuard + salonRoleGuard(OWNER, ADMIN)
/salons/:salonId/delete                        authGuard + salonRoleGuard(OWNER)
/salons/:salonId/media                         authGuard + salonRoleGuard(OWNER, ADMIN, STAFF)
/salons/:salonId/closures/**                   authGuard + salonRoleGuard(OWNER, ADMIN)
/salons/:salonId/services/**                   authGuard + salonRoleGuard(OWNER, ADMIN, STAFF)
/salons/:salonId/staff/**                      authGuard + salonRoleGuard(OWNER, ADMIN, STAFF)
/salons/:salonId/queues/:queueId/console       authGuard + salonRoleGuard(OWNER, ADMIN, STAFF)

/s/:slug                                       authGuard (MVP — guard removed when public access ships)
/s/:slug/q/:queueId                            authGuard (MVP — same)
```

---

## State Management Strategy

- **Session:** `TokenStore` + `CurrentUserStore` signals — single source of truth for `authGuard`.
- **Per-salon authorization:** `MembershipStore` (plain Map cache) behind `SalonContextService` — single source for `salonRoleGuard`, `tierGuard`, and all three directives.
- **Live queue state:** socket-fed signals scoped to the page. The socket is the source of truth; REST timeline is initial paint + reconnect fallback only. **Never cached.**
- **Live countdown:** `_tick` signal incremented by `setInterval` every second → `liveWaitMinutes` computed map derived from `servedAt` on the serving member. Runs in both console and visit components while mounted.
- **Lists (staff, services, closures):** fetched per view; no global entity cache for MVP.
- **My active entries:** `{queueId, entryId, salonId}[]` persisted to `localStorage` key `hairmela_active_entries`. Validated against live timeline on every socket update — stale entries are purged.
- **RxJS:** socket streams, single-flight refresh queuing. Everything else is signals.

---

## Frontend Engineering Standards

### Principles
- **SOLID · DRY · YAGNI · separation of concerns.**
- **Immutability:** `readonly` fields, spread updates. Never mutate a signal's value — `update()` / `set()` only.
- **Type safety:** strict mode; no `any`; explicit return types; no API types duplicated by hand.
- **Never duplicate UI logic.** Specifically:
  - **`ConfirmDialogService`** — the single way to confirm a destructive action. Returns `Observable<boolean>`.
  - **`ToastService`** — `toast.success()` / `toast.error()` / `toast.info()`. No component owns its own toast markup.

### Angular
- Standalone components (default — never set the flag); `input()` / `output()` functions; `inject()`, not constructor injection.
- `signal()` for local mutable state, `computed()` for derived state, `effect()` sparingly.
- Templates: `@if` / `@for` (with `track`) / `@switch`; `class`/`style` bindings, not `ngClass`/`ngStyle`; no arrow functions or `new Date()` in templates.
- Every route lazy (`loadComponent`/`loadChildren`); every subscription cleaned up with `takeUntilDestroyed(this._destroyRef)`.
- **Templates are always external files** — never `template:` inline.
- **Styling is Tailwind-first** — no `.scss` file unless Tailwind genuinely cannot do it. When no `.scss` needed, omit `styleUrl`.

### Error handling
- `isApiError` must be called on `err.error` (the parsed body), **not** on the raw `HttpErrorResponse`.
- Errors flow through the central interceptor; features add `catchError` only for flow-specific codes. Never swallow silently.

### Mobile Responsiveness
- **Every component and page must be mobile responsive — no exceptions.** HairMela is primarily a mobile-use product.
- Design mobile-first: `sm:`, `md:`, `lg:` prefixes.
- Touch targets at least 44×44px.

### Configuration discipline
- `environment.ts` owns `apiBaseUrl` (with `/v1`), `socketUrl`, `appBaseUrl`. No URL literals in source.

---

## Build Status

All 7 MVP phases are complete ✅

| Phase | Work |
|---|---|
| 1 ✅ | Foundation & Auth: workspace, environments, generated API client, error types, interceptors, TokenStore, CurrentUserStore, session init, app shell, ToastService, Login, Register, verify-email landing, authGuard/guestGuard |
| 2 ✅ | Authorization layer: MembershipStore, SalonContextService, salonRoleGuard, orgOwnerGuard, tierGuard, *hasRole, *requiresTier, tierFreeze |
| 3 ✅ | Dashboard, Org, Salons, Staff: My Salons, pending invites (moved to /notifications bell), org overview/rename/plan, create salon, settings, slug, share/QR, delete, staff list/invite/role/transfer/remove |
| 4 ✅ | Media: image-uploader, avatar, gallery + reorder — wired into salon, staff |
| 5 ✅ | Services: catalog CRUD, staff-service assignment (StaffService model, defaultServiceId from SalonStaff), default service |
| 6 ✅ | Schedules + Closures |
| 7 ✅ | Queues: QueueSocketService, staff console, salon visit page, live queue, party walk-in join, live countdown (servedAt-based), stale-localStorage validation, CalledBanner, leave |

---

## Post-MVP Backlog (in intended order)

1. **Notifications + Push:** full inbox page, unread badge, mark read/all, socket `notification$` toasts; PWA service worker (`@angular/pwa`) + `SwPush` subscribe/unsubscribe, contextual permission prompt (after joining a queue), logout unsubscribe ordering
2. **Public access + Analytics:** remove `authGuard` from `/s/:slug` routes, anonymous socket viewing, join handoff with return-url for signed-out visitors; analytics dashboard (Tier 2)
3. **Booking & appointments:** availability slot picker, book/cancel flows with tier-2 + verified-email gating, my-appointments page
4. **Auth completion & polish:** forgot password, reset password, full AXE pass on all public flows
5. **Smaller deferrals:** profile editing (needs backend `PATCH /users/profile`), visit history, subscription self-service UI, staff self-editing of schedules, i18n, e2e suite

---

## Coverage Check vs Backend

- Auth (register/login/refresh/verify/resend) → Auth feature + interceptors + session init; forgot/reset → backlog #4
- Per-salon roles + `/salons/:salonId/me` → MembershipStore + salonRoleGuard + three directives
- `/salons/mine` → Dashboard
- Org-owner authority → orgOwnerGuard + Organization feature
- Tiers + downgrade freeze + `SALON_FROZEN` → tierGuard + `*requiresTier` + `tierFreeze` + error handling
- Verified-email gating → **deferred post-MVP**
- Salons (slug, settings, address, timezone, delete + cascades) → Salons feature; QR via `qrcode` npm (`mod.default.toDataURL` in prod ESM bundle)
- Enriched public slug payload → Visit feature
- Staff lifecycle (invite → claim → accept/decline → role → transfer → remove) → Staff feature + /notifications
- `GET /salons/:salonId/staff` → `{ staff, queueId }[]` — console link resolves without extra request
- Services + StaffService join + default service → Services feature
- Schedules + Closures → Schedules/Closures features
- Queue timeline + `servedAt` → live countdown in both console and visit; `GET /queues/:queueId` (public) for status
- Media (Cloudinary, 5 MB caps, galleries, reorder) → shared media components
- Notifications endpoints → `/notifications` page (invites only); full inbox + push → backlog #1
- Analytics endpoints → backlog #2
- WebSocket contract (auth payload, rooms, `queueTimeline`, reconnect re-join) → QueueSocketService
- Error envelope + stable codes + requestId → core/errors + interceptor
- /v1 versioning + no-hardcoded-URLs → environment configuration discipline
