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
  - Estimated wait below (e.g. `est: 5m`)
- "Add Kids" button — opens party member rows (name + service picker per extra person)
- Two buttons at the bottom: "View queue" (goes to Screen 4) | "Back"

**Screen 4 — Live queue view for this barber (`/s/:slug/q/:queueId`)**
- Barber photo/avatar + name ("Dany the barber") + availability badge
- Two column headers: "Waiting" | "Estimated time"
- Scrollable queue list, each row: client label (anonymized: "Client 1", "Client 2"…) + wait time
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
**Styling:** Component-scoped SCSS + shared design tokens (co-founder is design lead); BEM naming
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
  "output": "src/app/core/api",
  "ignoreUnusedModels": false
}
```

**Scripts:** `"generate:api": "ng-openapi-gen --config ng-openapi-gen.json"`

**Rules:**
- `src/app/core/api/**` is generated — never hand-edited, regenerated after every backend DTO change. A stale client shows up as TypeScript errors, which is the point.
- The generated `ApiConfiguration.rootUrl` is set from `environment.apiBaseUrl` in `app.config.ts` — the single place the API URL exists.
- Generated services are the only HTTP entry points. Thin feature services wrap them where orchestration is needed; components never inject generated services *and* `HttpClient` side by side.

**What is NOT generated (maintained by hand in `core/`):**
- `error-codes.ts` — mirror of the backend's stable code enum (small, changes rarely, breaks loudly)
- `api-error.types.ts` — the error envelope shape `{ statusCode, code, message, details, timestamp, path, requestId }`
- Socket payload types (`TimelineEntry`, `CustomerCalledPayload`) — WebSocket events aren't in the OpenAPI spec

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
├── core/                            ← singletons (providedIn: 'root'), loaded once
│   ├── api/                         ← GENERATED (models/ + services/) — do not edit
│   ├── auth/
│   │   ├── auth.service.ts          ← login, register, logout, verify/resend
│   │   ├── token.store.ts           ← access token (memory signal) + refresh token (localStorage)
│   │   ├── current-user.store.ts    ← signal<User | null> hydrated from GET /auth/me
│   │   └── session-init.ts          ← app initializer: silent refresh → /auth/me → hydrate
│   ├── salon-context/
│   │   ├── salon-context.service.ts ← active salonId from route; exposes membership signal
│   │   └── membership.store.ts      ← per-salon cache of GET /salons/:salonId/me
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
│   │   └── socket.types.ts
│   └── toast/
│       └── toast.service.ts
│
├── shared/                          ← reusable, imported per-feature
│   ├── directives/
│   │   ├── has-role.directive.ts        ← *hasRole="['OWNER','ADMIN']"
│   │   ├── requires-tier.directive.ts   ← *requiresTier="2" (lock | hide modes)
│   │   └── tier-freeze.directive.ts     ← [tierFreeze]="membership().isFrozen"
│   ├── components/
│   │   ├── pagination/                  ← consumes PaginatedResponse meta
│   │   ├── confirm-dialog/
│   │   ├── image-uploader/              ← file pick, client-side validate (jpeg/png/webp, ≤5 MB), multipart
│   │   ├── gallery/                     ← display + drag-reorder
│   │   ├── avatar/                      ← NgOptimizedImage + fallback initials
│   │   ├── qr-code/                     ← client-side QR from appBaseUrl + slug (render + PNG download)
│   │   ├── status-badge/                ← queue/entry/member status pills
│   │   ├── verify-email-prompt/         ← shown proactively + on EMAIL_NOT_VERIFIED; resend button
│   │   ├── empty-state/
│   │   └── loading-spinner/
│   └── pipes/
│       ├── time-ago.pipe.ts
│       ├── duration.pipe.ts             ← minutes → "1h 20m"
│       └── salon-time.pipe.ts           ← UTC → salon IANA timezone display
│
└── features/                        ← lazy-loaded
    ├── auth/            (login, register, verify-email)
    ├── dashboard/
    ├── organization/
    ├── salons/
    ├── staff/           (management + invite accept/decline)
    ├── services/
    ├── schedules/
    ├── closures/
    ├── queue/           (staff console)
    ├── visit/           (customer-facing salon page at /s/:slug + join/track)
    └── account/
```

Each feature folder follows: `*.component.ts/html/scss` (orchestration only), `*.service.ts` (feature logic over the generated client), `*.types.ts` (view-model types only — API types come from `core/api`).

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
- `logout()` — disconnect the socket, clear tokens + stores, navigate `/login`. There is no backend logout endpoint (stateless JWT; revocation deferred) — logout is client-side. *(When push ships post-MVP, `DELETE /push/subscribe` must run first in this sequence, while the session is still valid.)*
- `verifyEmail(token)` → `POST /auth/verify-email` (token in the **body**, taken from the landing page's query param); `resendVerification()` → `POST /auth/resend-verification`.

### current-user.store.ts
`signal<User | null>` from `GET /auth/me`. `emailVerified` is available on the type but not acted on in MVP — no verify prompt, no gating.

### membership.store.ts + salon-context.service.ts
- `getMembership(salonId)`: returns cached `{ role, isStaff, canManageSalon, canManageStaff, tier, isFrozen }` or fetches `GET /salons/:salonId/me`. This is the **only** role/tier-discovery mechanism in the app.
- Cache invalidation: on accept/decline invite, role change, ownership transfer, and logout. One plain `Map<salonId, Membership>` — no LRU machinery (a user belongs to a handful of salons; YAGNI).
- `SalonContextService` derives the active `salonId` from the route and exposes the active membership as a signal — guards and the three directives all read from here, so route protection and template state share one source and can never disagree.

---

## Guards (functional)

| Guard | Logic | Used on |
|---|---|---|
| `authGuard` | No valid session → store attempted URL → redirect `/login` (return-url honored after login) | all authenticated routes |
| `guestGuard` | Authenticated → redirect `/dashboard` | `/login`, `/register` |
| `salonRoleGuard` | Reads `:salonId`, awaits `MembershipStore.getMembership()`, checks `route.data.roles`. `CUSTOMER` or insufficient role → redirect to the salon's visit page or dashboard | salon management routes |
| `orgOwnerGuard` | User owns `:orgId` (via `GET /organizations/mine`, cached) | `/org/*` |
| `tierGuard` | `membership.tier >= route.data.requiredTier` → pass; else redirect to the plan explainer. Built in Phase 2 with the rest of the enforcement layer; its route consumers (analytics, booking) arrive post-MVP, while the `*requiresTier` directive is in active use from Phase 3 | tier-gated routes (post-MVP) |

Guards are async-safe: they await the membership fetch (first visit to a salon) rather than reading a possibly-empty cache.

---

## Directives (template-level control)

**`*hasRole`** — structural; renders content only if the active-salon membership role is in the list. Reads `SalonContextService`, so it's correct per salon (same user: OWNER controls at Salon A, none at Salon B).
```html
<button *hasRole="['OWNER','ADMIN']">Invite staff</button>
```

**`*requiresTier`** — default mode **lock**: render disabled with a lock icon + "Upgrade to enable" nudge. In MVP this gates the things Tier 1 limits — inviting beyond one barber, creating beyond one salon — and dresses the locked teasers for post-MVP Tier 2 features. `mode: 'hide'` for the rare case a locked control would confuse. The nudge routes to the org plan screen. Reads `membership().tier`.

**`tierFreeze`** (attribute) — downgrade scenario. When `membership().isFrozen`, wrapped controls render read-only with a "frozen — upgrade to edit" overlay, mirroring exactly what the backend's `@ActiveSalon` guard rejects (new joins, invites). Enforcement is server-side; this is honest UI, with `SALON_FROZEN` handled centrally if a frozen action slips through anyway.

---

## Interceptors (functional, ordered: jwt → refresh → error)

**`jwtInterceptor`** — attaches `Authorization: Bearer <access>` to requests targeting `environment.apiBaseUrl`, skipping `/auth/login`, `/auth/register`, `/auth/refresh`, and public reads. Never attaches tokens to third-party hosts (Cloudinary URLs are plain GETs).

**`refreshInterceptor`** — on 401 with code `TOKEN_EXPIRED`: single-flight refresh (one `POST /auth/refresh` shared by all concurrent 401s via RxJS), queue and retry the originals with the new access token. Refresh fails or code is `TOKEN_INVALID` → full logout. Never retries the refresh call itself.

**`errorInterceptor`** — parses the envelope into `ApiError` (with an `isApiError` guard for non-envelope failures like network drops), branches on `code` per the table below, and rethrows a typed error so features can add flow-specific handling. Unknown/500 errors: generic toast **including the `requestId`** ("Something went wrong — ref b3f1c9e2") so a user report can be matched to the backend's correlated logs and Sentry events.

---

## Error Handling Convention (code → UI behavior)

The frontend branches on `code`, never on `message` (backend contract). Central handling lives in the interceptor; rows marked *local* are handled by the owning feature. Codes for deferred features (`SLOT_*`, `CANCELLATION_WINDOW_PASSED`) get their handlers when those features ship.

| Code(s) | Behavior |
|---|---|
| `TOKEN_EXPIRED` | Silent refresh + retry (refresh interceptor) |
| `TOKEN_INVALID` | Logout + redirect to login |
| `INVALID_CREDENTIALS` | *local:* inline form error on login |
| `EMAIL_ALREADY_REGISTERED` | *local:* inline error on register, link to login |
| `EMAIL_NOT_VERIFIED` | ~~Open `VerifyEmailPrompt`~~ — **not handled in MVP; backend guard not applied** |
| `VALIDATION_FAILED` | *local:* map `details[{field, constraint}]` onto form controls; toast fallback |
| `TIER_REQUIRED` | Upgrade nudge — owner sees the plan screen link, non-owner sees "ask the owner" |
| `SALON_FROZEN` | Frozen-salon prompt: "this salon is over the plan's limit — upgrade to reactivate" (owner) / informational notice (others) |
| `SALON_LIMIT_REACHED` | *local:* upgrade nudge on Create Salon |
| `SALON_SLUG_TAKEN`, `SERVICE_NAME_TAKEN`, `STAFF_ALREADY_INVITED` | *local:* inline field errors |
| `CANNOT_REMOVE_OWNER` | Toast directing to the Transfer Ownership flow |
| `PARTY_TOO_LARGE` | *local:* inline error on join form (form also pre-caps at `settings.maxPartySize`) |
| `QUEUE_NOT_OPEN`, `QUEUE_ALREADY_CLOSED` | Toast + refresh queue state; join CTA disabled |
| `ENTRY_NOT_WAITING`, `ENTRY_ALREADY_SERVING`, `MEMBER_NOT_SERVING`, `ENTRY_NOT_FOUND`, `MEMBER_NOT_FOUND` | *local (console):* "resolve the current customer first" flow + timeline re-sync — the console treats a 409 on call-next as a prompt to complete/no-show the SERVING entry |
| `*_NOT_FOUND` (salon/org/staff/service/queue/notification) | Toast + navigate to the nearest safe parent view |
| HTTP 429 (when backend throttling lands post-MVP) | Toast "too many requests — wait a moment"; cheap to handle now |
| Network error / non-envelope | "You appear to be offline" toast; queue views show the socket's reconnecting state |

---

## WebSocket Client (QueueSocketService)

Wraps `socket.io-client` against the backend's `/queues` namespace, implementing the gateway contract exactly.

**Connection:**
- `io(environment.socketUrl + '/queues', { auth: { token } })` — JWT in the **auth payload**, never the query string (the backend moved it there specifically to keep tokens out of proxy logs; the frontend must not undo that).
- All MVP users are signed in, so connections carry credentials; the gateway's anonymous-viewer mode goes live with the post-MVP public-access work.
- On login/logout the socket reconnects/disconnects.

**API:**

| Member | Purpose |
|---|---|
| `connect()` / `disconnect()` | Lifecycle; reads token from `TokenStore` at connect time |
| `watchQueue(queueId)` | emit `joinQueue` — public room; server immediately replies with the current `queueTimeline` |
| `watchQueueAsStaff(queueId)` | emit `joinQueueStaff` (token re-verified server-side; also joins `queue:{id}:staff`) |
| `unwatchQueue(queueId)` | emit `leaveQueue` |
| `queueTimeline$(queueId)` | Observable of `TimelineEntry[]` — the full recomputed timeline on every `queue.updated` |
| `customerCalled$(queueId)` | room-level called broadcast (anonymized — used for "now serving" display) |
| `connectionState$` | connected / reconnecting — surfaced as a banner on live views |

The gateway also emits personal `notification` events to `user:{userId}` rooms; the client subscribes to those when the notifications feature ships post-MVP.

**Reconnect discipline:** on reconnect, re-emit `joinQueue`/`joinQueueStaff` for every watched queue (socket.io does not restore rooms). The immediate `queueTimeline` reply doubles as state resync after a connection gap — no REST refetch needed.

**Privacy note carried from the backend:** room payloads are anonymized (first name + initial / position / status). The UI must not pretend otherwise — full member details render only in the staff console (staff room / role-guarded REST) and in the customer's own entry card.

---

## Feature Modules

Each feature lists routes, components, the backend endpoints consumed (generated client methods), and guards. Role/tier annotations mirror the backend tables exactly.

### Auth — `features/auth/`

**Routes:** `/login`, `/register`, `/verify-email`

| Component | Purpose | Endpoint |
|---|---|---|
| LoginComponent | Email/password; return-url redirect | POST /auth/login |
| RegisterComponent | email, password, first/last name, optional phone. No org setup step — the backend auto-creates org + free subscription on registration. Post-signup, pending staff invites surface automatically (backend `claimInvites` linked them by email) | POST /auth/register |
| VerifyEmailLandingComponent | Reads `?token=` from the emailed link, POSTs it, shows success/failure, refreshes `/auth/me` | POST /auth/verify-email |

**Guards:** `guestGuard` on login/register; the verify-email landing is public (users may open the link in a fresh browser).
**Guards:** `guestGuard` on login/register; the verify-email landing is public (users may open the link in a fresh browser).
**Note:** verification is not enforced in MVP — the landing page just shows a success/failure message. Forgot/reset password are in the post-MVP backlog.

### Dashboard — `features/dashboard/`

**Routes:** `/dashboard`

| Component | Purpose | Endpoint |
|---|---|---|
| DashboardComponent | Post-login landing | — |
| MySalonsListComponent | Every salon where the user is active staff, with role badge + role-filtered quick actions | GET /salons/mine → `{ salon, role }[]` |
| PendingInvitesComponent | Surfaces STAFF_INVITED notifications with inline Accept / Decline. This is a **single scoped call** to `GET /notifications` (filtered by type) — invites are a core membership flow; the full inbox feature stays in the backlog | GET /notifications + staff accept/decline |
| NoSalonsEmptyState | Pure customers: "create a salon" CTA | — |

**Guards:** `authGuard`.

### Organization — `features/organization/`

**Routes:** `/org/:orgId`

| Component | Purpose | Endpoint |
|---|---|---|
| OrgOverviewComponent | Org name, salons, **read-only** plan/tier display | GET /organizations/:orgId + membership tier |
| OrgSettingsComponent | Rename org | PATCH /organizations/:orgId |
| PlanExplainerComponent | Static Tier 1/2/3 comparison — the target of every upgrade nudge. **No upgrade/downgrade actions:** the backend exposes no subscription HTTP routes (deferred). Copy says "contact us to upgrade" until they exist | — |

**Guards:** `authGuard + orgOwnerGuard`. Org selection via `GET /organizations/mine`.

### Salons — `features/salons/`

**Routes:** `/salons/new`, `/salons/:salonId`, `/salons/:salonId/settings`

| Component | Purpose | Endpoint |
|---|---|---|
| CreateSalonComponent | Name, structured address (country/state/city/street — the Address table), IANA timezone picker (default Africa/Lagos), operating hours, default slot duration | POST /salons |
| SalonOverviewComponent | Summary: today's queues, staff, quick links — role-filtered via `*hasRole` | GET /salons/:salonId |
| SalonSettingsComponent | Operating hours, defaultSlotDuration, settings JSON (noShowWindow, allowWalkIns, maxPartySize) | PATCH /salons/:salonId, PATCH .../settings |
| SalonSlugComponent | View/edit slug; `SALON_SLUG_TAKEN` inline; **OWNER only** | PATCH /salons/:salonId/slug |
| SalonShareComponent | Client-side QR (`appBaseUrl + '/s/' + slug`) render + PNG download + copy link. The QR target is the visit page route, which never changes — printed codes stay valid when public access ships | — |
| DeleteSalonComponent | Confirm dialog spelling out the cascade (queues closed, entries cancelled, customers notified); **OWNER only** | DELETE /salons/:salonId |

**Guards:** `/salons/new` = `authGuard` only — the backend's `POST /salons` is plain Authenticated and auto-creates an org if needed; salon-count limits are enforced server-side (`SALON_LIMIT_REACHED` → upgrade nudge). `:salonId` = `salonRoleGuard(OWNER, ADMIN, STAFF)`; settings = `(OWNER, ADMIN)`; slug + delete controls additionally `*hasRole="['OWNER']"`.

### Staff — `features/staff/`

**Routes:** `/salons/:salonId/staff`, `/salons/:salonId/staff/:staffId`

| Component | Purpose | Endpoint |
|---|---|---|
| StaffListComponent | Paginated list, role + status badges (PENDING/ACTIVE/INACTIVE). Response is `{ staff, queueId }[]` — `queueId` is available directly from the list, so the console link resolves without an extra request | GET /salons/:salonId/staff → `{ staff, queueId }[]` |
| InviteStaffComponent | Email + role (ADMIN/STAFF — backend: cannot assign OWNER). Handles `STAFF_ALREADY_INVITED`; re-inviting INACTIVE members is supported server-side. Invite controls wear `*requiresTier` lock at the tier's staff limit, and `tierFreeze` on frozen salons | POST .../staff/invite |
| StaffDetailComponent | Profile, role, services offered, gallery | — |
| ChangeRoleComponent | ADMIN ↔ STAFF; `CANNOT_REMOVE_OWNER` routes to the transfer flow | PATCH .../staff/:staffId/role |
| TransferOwnershipComponent | Atomic promote+demote with explicit confirm ("you will become ADMIN"); **OWNER only** | PATCH .../staff/transfer-ownership |
| RemoveStaffComponent | Confirm dialog spelling out the cascade (queue closed, entries cancelled, customers notified) | DELETE .../staff/:staffId |
| MyInviteActionsComponent | Accept / Decline for the *invitee* (used by the dashboard's PendingInvites). No email verification gate in MVP — accept/decline directly | POST .../staff/accept, POST .../staff/decline |

**Guards:** management = `salonRoleGuard(OWNER, ADMIN)`; accept/decline = `authGuard` only — the invitee has no SalonStaff role yet, mirroring the backend's JwtAuthGuard-only routes (the invite is matched by the user's email). There is no "link existing user" flow: linking is invite + automatic claim on registration.

### Services — `features/services/`

**Routes:** `/salons/:salonId/services`

| Component | Purpose | Endpoint |
|---|---|---|
| ServiceListComponent | Paginated catalog (name, duration, price — display only, no payments) | GET /salons/:salonId/services |
| ServiceFormComponent | Create/edit; `SERVICE_NAME_TAKEN` inline | POST + PATCH .../services |
| DeactivateServiceComponent | Confirm dialog noting the cascade (unassigned from staff, defaults nulled, staff notified; in-flight queue entries keep their duration snapshot) | DELETE .../services/:serviceId |
| StaffServiceAssignComponent | Per-staff service checklist + default-service picker (default must be one of the assigned) | GET/POST/DELETE .../staff/:staffId/services(/:serviceId), PATCH .../default-service |

**Guards:** catalog CRUD = `(OWNER, ADMIN)`; assignment routes allow `(OWNER, ADMIN, STAFF)` per backend — STAFF manage their own list (UI surfaces "my services" to STAFF; editing others' stays behind `*hasRole="['OWNER','ADMIN']"`).

### Schedules — `features/schedules/`

**Routes:** `/salons/:salonId/staff/:staffId/schedules`

| Component | Purpose | Endpoint |
|---|---|---|
| WeeklyScheduleComponent | 7-day grid of per-day working hours (HH:mm, salon timezone). Working hours drive the backend's queue auto-open/auto-close, so this matters even without appointments | GET .../schedules |
| ScheduleDayEditor | Add / edit / remove a day's hours | POST + PATCH + DELETE .../schedules(/:scheduleId) |

**Guards:** `salonRoleGuard(OWNER, ADMIN)` — staff self-editing is not in the backend contract; if wanted later, it's a backend authorization change first.

### Closures — `features/closures/`

**Routes:** `/salons/:salonId/closures` (salon-wide + per-staff tabs)

| Component | Purpose | Endpoint |
|---|---|---|
| ClosureListComponent | Upcoming whole-day closures, paginated, date ASC | GET .../closures, GET .../staff/:staffId/closures |
| AddClosureComponent | Date (`YYYY-MM-DD` string — matches backend storage, no timezone math) + reason; salon or staff scope | POST .../closures, POST .../staff/:staffId/closures |
| DeleteClosureButton | Remove | DELETE (matching scope) |

**Guards:** `salonRoleGuard(OWNER, ADMIN)`. Partial-day closures are deferred backend-side.

### Queue (staff console) — `features/queue/`

**Routes:** `/salons/:salonId/queues/:queueId/console`

| Component | Purpose | Endpoint / Socket |
|---|---|---|
| QueueConsoleComponent | Live management view; joins as staff over the socket | watchQueueAsStaff + GET /queues/:queueId/timeline (initial/fallback) |
| QueueBoardComponent | Timeline order, per-entry cards with party members, statuses, computed waits. Renders both entry types — the timeline model includes APPOINTMENT entries even though no booking UI ships in MVP | `queueTimeline$` |
| QueueStatusToggle | OPEN / PAUSED / CLOSED with state explainer (PAUSED keeps accepting joins; CLOSED rejects them) | PATCH .../status |
| CallNextButton | Promote head WAITING → SERVING. A 409 means the current entry isn't resolved — the UI opens the resolve flow instead of showing a raw error | POST .../call-next |
| EntryMemberRow | Per-member Serve / Complete / Extend (+minutes) controls; the entry auto-closes when all members are SERVED (server-side) | PATCH .../members/:memberId/serve · /complete · /extend |
| NoShowButton / CancelEntryButton | Resolve an entry without serving | PATCH .../entries/:entryId/no-show, DELETE .../entries/:entryId |
| EndOfDayPanel | After auto-close, remaining WAITING entries persist by design — bulk-resolve UI (cancel each) for ending the day | cancel per entry |

**Guards:** `salonRoleGuard(OWNER, ADMIN, STAFF)`.

### Visit (customer-facing) — `features/visit/`

The salon page customers land on from the shared link / QR code. **Sign-in required for MVP** (`authGuard`); the route and URL shape are final, so printed QR codes stay valid when anonymous public access ships post-MVP — that work removes the guard, it doesn't move the page.

**Routes:** `/s/:slug`, `/s/:slug/q/:queueId`

| Component | Purpose | Endpoint / Socket |
|---|---|---|
| SalonVisitComponent | Salon profile, gallery, services, hours, and barber cards (photo, services, live queue snippet) from the enriched slug payload | GET /salons/slug/:slug → `{ salon, staff[] }` (each staff: queueId, photoUrl, serviceIds), GET .../services, GET /salons/:id/media |
| LiveQueueComponent | Live queue for one barber: anonymized entries, positions, waits | GET /queues/:queueId/timeline + `queueTimeline$` |
| JoinQueueComponent | **Party-aware walk-in join:** leader row prefilled with the user's first name, plus "add person" rows up to `settings.maxPartySize` total, each with a name + service picker (no selection = barber's default service, per backend). Single batch POST — the backend inserts the whole party consecutively under one lock. Form blocks a second self-entry if one is already active. Disabled when CLOSED; "on break — line still forming" notice when PAUSED; frozen salons show the upgrade-blocked notice | POST .../walk-in |
| MyEntryCard | Live position (1-based; 0 = being served) + estimated wait for the user's entry, matched from the timeline by entryId. Entry references `{queueId, entryId}` returned at join are kept in localStorage so a reload mid-wait keeps the card (a server-side "my active entries" listing is in the backlog) | `queueTimeline$` |
| CalledBanner | Full-screen "You're up!" / "Tobi is up!" when the user's own entry flips to SERVING in the timeline — derived from `queueTimeline$`, so it needs no notification infrastructure | `queueTimeline$` |
| LeaveQueueButton | Cancel own WAITING entry (confirm) | DELETE .../walk-in/:entryId |

**Guards:** `authGuard` (MVP). Join/leave need no salon role — any signed-in user is a customer (backend: no SalonStaff record = customer).

### Account — `features/account/`

**Routes:** `/account`

| Component | Purpose | Endpoint |
|---|---|---|
| ProfileComponent | **Read-only** profile from `/auth/me` + verification status + resend button. Editing is deferred — `PATCH /users/profile` does not exist backend-side | GET /auth/me, POST /auth/resend-verification |

**Guards:** `authGuard`.

---

## Routing Map (top-level)

```
/login                                guestGuard
/register                             guestGuard
/verify-email                         public (?token= from email link)

/dashboard                            authGuard
/account                              authGuard

/org/:orgId                           authGuard + orgOwnerGuard

/salons/new                           authGuard                       (backend enforces limits)
/salons/:salonId                      authGuard + salonRoleGuard(OWNER, ADMIN, STAFF)
/salons/:salonId/settings             authGuard + salonRoleGuard(OWNER, ADMIN)
/salons/:salonId/staff/**             authGuard + salonRoleGuard(OWNER, ADMIN)
/salons/:salonId/services/**          authGuard + salonRoleGuard(OWNER, ADMIN, STAFF)
/salons/:salonId/staff/:id/schedules  authGuard + salonRoleGuard(OWNER, ADMIN)
/salons/:salonId/closures/**          authGuard + salonRoleGuard(OWNER, ADMIN)
/salons/:salonId/queues/:id/console   authGuard + salonRoleGuard(OWNER, ADMIN, STAFF)

/s/:slug                              authGuard (MVP — guard removed when public access ships)
/s/:slug/q/:queueId                   authGuard (MVP — same)
```

---

## State Management Strategy

- **Session:** `TokenStore` + `CurrentUserStore` signals — single source of truth for `authGuard` and the verify prompt.
- **Per-salon authorization:** `MembershipStore` (plain Map cache) behind `SalonContextService` — single source for `salonRoleGuard`, `tierGuard`, and all three directives. One source means route guards and template directives can never disagree.
- **Live queue state:** socket-fed signals scoped to the page (`toSignal` on `queueTimeline$`). The socket is the source of truth; REST `GET /queues/:queueId/timeline` is initial paint + reconnect fallback only. **Never cached** — staleness is the failure mode of a queue app.
- **Lists (staff, services, closures):** fetched per view with pagination signals; no global entity cache for MVP (YAGNI — revisit only with measured need).
- **My active entries:** `{queueId, entryId}[]` persisted to localStorage so a reload mid-wait doesn't lose the position card.
- **RxJS:** socket streams, single-flight refresh queuing, debounced slug input. Everything else is signals.

---

## Frontend Engineering Standards

### Principles
- **SOLID · DRY · YAGNI · separation of concerns.** Business logic in services; components orchestrate only.
- **Immutability:** `readonly` fields, spread updates. Never mutate a signal's value — `update()` / `set()` only (`this._items.update(items => [...items, item])`).
- **Type safety:** strict mode; no `any` (use `unknown` + narrowing); explicit return types on all functions; view-model shapes in a feature `*.types.ts`; API shapes only from `core/api`.

### Angular
- Standalone components (default — never set the flag); `input()` / `output()` functions, not decorators; `inject()`, not constructor injection; host bindings in the `host` object, not `@HostBinding`/`@HostListener`.
- `signal()` for local mutable state, `computed()` for derived state (and memoizing heavy computations), `effect()` sparingly for side effects.
- Templates: `@if` / `@for` (with `track` on a unique id) / `@switch`; `class`/`style` bindings, not `ngClass`/`ngStyle`; no arrow functions and no globals (`new Date()`) in templates — compute in the class.
- `NgOptimizedImage` for all images — with a **Cloudinary loader** (`provideCloudinaryLoader`), since all production media is Cloudinary-hosted; free responsive sizing.
- Every route lazy (`loadComponent`/`loadChildren`); every subscription cleaned up with `takeUntilDestroyed(this._destroyRef)`; `combineLatest` in object form.

### Services & data
- Singletons: `providedIn: 'root'`. One concern per service.
- Data methods return `Observable` (or expose signals) — never raw Promises; the generated client is Observable-native.
- **Caching policy (deliberately minimal):** membership per salon and static lookups only; invalidated on the mutations that change them; no LRU machinery. Live queue data is never cached.
- No N+1 request chains: if the UI needs an aggregate the API doesn't serve in one call, that's a backend endpoint request — not a client-side fan-out.

### Error handling
- Errors flow through the central interceptor; features add `catchError` only for the flow-specific codes named in the table above. Subscribe with `{ next, error }` — never swallow silently.
- No try-catch for control flow — `catchError` in pipelines, guard clauses for nulls. Try-catch only in async/await bodies, cleanup, or third-party calls that throw.

### Style & structure
- Per-feature layout: `component.ts/html/scss` + `feature.service.ts` + `feature.types.ts` (+ a pure-function helper service when calculations grow).
- Member order in components: inputs → outputs → injected deps → signals → computed → effects → lifecycle → protected → private. Template-accessed members `protected`; internals `private`; `$` suffix on Observables.
- SCSS: BEM (`.block__element--modifier`); design tokens from the shared layer; no inline styles; avoid `::ng-deep` (if a UI library is adopted later, scope any override to a panel class).
- Cleanup `ResizeObserver`/`MutationObserver`/manual listeners via `DestroyRef`.

### Accessibility
- Target WCAG AA; run AXE on the high-traffic flows each phase: login/register, salon visit page, join flow, staff console. Live regions (`aria-live="polite"`) for position changes and the called banner — a queue app's core output is a changing number; screen readers must hear it change.

### Configuration discipline (mirrors the backend's rule)
- `environment.ts` owns `apiBaseUrl` (with `/v1`), `socketUrl`, `appBaseUrl` (for QR/share links). No URL literals in source. Production values injected at build.

### Cross-platform readiness (Capacitor later, per roadmap)
- No web-only APIs without graceful fallback (clipboard, vibration behind small wrappers); relative asset paths; API/socket URLs already environment-driven — the app must run unchanged inside a WebView. `npx cap add android` later without refactor.

---

## Build Order

Mirrors the backend's discipline: foundation → enforcement layers → features, one concern per phase.

| Phase | Frontend Work | Mirrors (backend phase) |
|---|---|---|
| 1 | **Foundation & Auth:** workspace, environments, generated API client wiring (`generate:api`), error envelope types + `error-codes.ts`, interceptors (jwt → refresh → error), TokenStore + CurrentUserStore + session initializer, app shell + ToastService, **Login, Register**, verify-email landing, `authGuard`/`guestGuard` | 1 |
| 2 | **Authorization layer:** MembershipStore + SalonContextService, `salonRoleGuard`, `orgOwnerGuard`, `tierGuard`, `*hasRole`, `*requiresTier`, `tierFreeze`, frozen-salon banner | 2 |
| 3 | **Dashboard, Org, Salons, Staff:** My Salons (`/salons/mine`), pending invites + accept/decline (no email gating), org overview/rename + plan explainer, create salon (address/timezone/hours), settings, slug, share/QR (client-side), delete; staff list/invite/role/transfer/remove | 3 |
| 4 | **Media:** image-uploader (client-side mime/size validation matching backend caps), avatar, gallery + reorder — wired into salon, staff, profile | 4 |
| 5 | **Services:** catalog CRUD, staff-service assignment, default service | 5 |
| 6 | **Schedules + Closures** | 6 |
| 7 | **Queues:** QueueSocketService, staff console (status, call-next + resolve flow, per-member serve/complete/extend, no-show, cancel, end-of-day), salon visit page (`/s/:slug`, authed), live queue view, party walk-in join, MyEntryCard + CalledBanner (timeline-driven), leave | 7 |

**MVP ends at Phase 7** — a complete walk-in queue product: set up a salon, invite staff, define services and hours, run live queues, customers join and track in real time.

---

## Post-MVP Backlog (in intended order)

1. **Notifications + Push:** full inbox page, unread badge, mark read/all, socket `notification$` toasts; PWA service worker (`@angular/pwa`) + `SwPush` subscribe/unsubscribe against the VAPID endpoints, contextual permission prompt (after joining a queue — never on first load), logout unsubscribe ordering (`DELETE /push/subscribe` before clearing the session)
2. **Public access + Analytics:** remove `authGuard` from `/s/:slug` routes, anonymous socket viewing, staff public profiles, join handoff with return-url for signed-out visitors; analytics dashboard (summary cards, trends chart, service breakdown, staff performance — Tier 2, salon-timezone params, range picker)
3. **Booking & appointments:** availability slot picker (`GET .../availability?date=`), book/cancel flows with tier-2 + verified-email gating, `SLOT_ALREADY_BOOKED`/`SLOT_NOT_AVAILABLE`/`CANCELLATION_WINDOW_PASSED` handling, my-appointments page (also needs the backend's customer-appointments listing route, which is referenced in its pagination defaults but not yet in its endpoint tables)
4. **Auth completion & polish:** forgot password, reset password, optional Sentry browser SDK, full AXE pass on all public flows
5. **Smaller deferrals:** profile editing (needs backend `PATCH /users/profile`), visit history / "book again", subscription self-service UI, staff self-editing of schedules, offline support beyond app shell, i18n, e2e suite (start with join → called → complete)

---

## Coverage Check vs Backend

Every backend capability has a frontend home — or a named place in the backlog:

- Auth (register/login/refresh/verify/resend) → Auth feature + interceptors + session init; forgot/reset → backlog #4
- Per-salon roles + `/salons/:salonId/me` introspection (incl. tier + isFrozen) → MembershipStore + salonRoleGuard + the three directives
- `/salons/mine` → Dashboard My Salons
- Org-owner authority → orgOwnerGuard + Organization feature
- Tiers + downgrade freeze + `SALON_FROZEN` → tierGuard + `*requiresTier` + `tierFreeze` + error handling
- Verified-email gating → **deferred post-MVP**; backend guard not applied; `VerifyEmailPrompt` and `EMAIL_NOT_VERIFIED` handling ship when verification is enforced
- Salons (slug, settings, address, timezone, soft delete + cascades) → Salons feature; QR client-side against the stable `/s/:slug` route
- Enriched public slug payload (`{ salon, staff[] }` with queueIds) → Visit feature
- Staff lifecycle (invite → claim → accept/decline → role change → transfer → remove) → Staff feature + dashboard invites
- `GET /salons/:salonId/staff` returns `{ staff, queueId }[]` — `StaffListComponent` gets the console link without a second request; no extra fan-out needed
- Services + StaffService join + default service + deactivation cascade → Services feature
- Schedules (POST/PATCH/DELETE) + Closures → Schedules/Closures features
- Unified queue (timeline model, party members, per-member lifecycle, call-next resolve rule, no-show timer, PAUSED-accepts-joins, end-of-day) → Queue + Visit features
- Appointments endpoints → backlog #3 (console already renders APPOINTMENT entries defensively)
- Media (Cloudinary, 5 MB/image-mime caps, galleries, reorder) → shared media components
- Notifications endpoints → scoped invite surfacing now; full inbox + push → backlog #1; SMS/WhatsApp are backend stubs — no UI
- Analytics endpoints → backlog #2
- WebSocket contract (auth payload, rooms, `queueTimeline`/`customerCalled`, anonymized payloads, reconnect re-join) → QueueSocketService; `notification` stream → backlog #1
- Error envelope + stable codes + requestId → core/errors + interceptor + code table
- Pagination contract → generated meta models + shared Pagination component
- /v1 versioning + no-hardcoded-URLs → environment configuration discipline
