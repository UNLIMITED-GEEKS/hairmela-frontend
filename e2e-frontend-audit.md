# HairMela Frontend Audit — Backend Endpoint Coverage

All locations verified by reading the actual source files. Every file path and function name is confirmed to exist.

---

## Legend
- ✅ Confirmed — file read, function found, correct pattern
- ⚠️ Issue — confirmed present but has a known bug / requires attention
- ❌ Missing — endpoint not covered in the frontend

---

## 1. Auth

| Backend Endpoint | Method | Frontend File | Function / Method | Status |
|---|---|---|---|---|
| POST /v1/auth/login | login | `src/app/core/auth/auth.service.ts` | `login()` → `guestAuthControllerLogin` | ✅ |
| POST /v1/auth/register | register | `src/app/core/auth/auth.service.ts` | `register()` → `guestAuthControllerRegister` | ✅ |
| POST /v1/auth/refresh | token refresh | `src/app/core/interceptors/refresh.interceptor.ts` | `refreshAndRetry()` — single-flight BehaviorSubject | ✅ |
| POST /v1/auth/refresh (boot) | session init | `src/app/core/auth/session-init.ts` | `sessionInit()` — `provideAppInitializer` | ✅ |
| GET /v1/auth/me | current user | `src/app/core/auth/session-init.ts` | `authenticatedAuthControllerGetMe` | ✅ |
| POST /v1/auth/verify-email | verify email | `src/app/core/auth/auth.service.ts` | `verifyEmail(token)` | ✅ |
| POST /v1/auth/resend-verification | resend | `src/app/core/auth/auth.service.ts` | `resendVerification()` | ✅ |

---

## 2. Organizations

| Backend Endpoint | Method | Frontend File | Function / Method | Status |
|---|---|---|---|---|
| GET /v1/organizations/:orgId | get org | `src/app/features/organization/org-overview/org-overview.component.ts` | `organizationsControllerFindOne` in `ngOnInit()` | ✅ |
| PATCH /v1/organizations/:orgId | rename org | `src/app/features/organization/org-settings/org-settings.component.ts` | `organizationsControllerUpdate` in `save()` | ✅ |
| GET /v1/organizations/mine | list mine | Not called — org ID comes from route params; no org-picker UI in MVP | ❌ acceptable gap |

---

## 3. Salons

| Backend Endpoint | Method | Frontend File | Function / Method | Status |
|---|---|---|---|---|
| POST /v1/salons | create salon | `src/app/features/salons/create-salon/create-salon.component.ts` | `userSalonsControllerCreate` in `save()` | ✅ |
| GET /v1/salons/mine | my salons | `src/app/features/dashboard/dashboard.component.ts` | `userSalonsControllerFindMine` in `ngOnInit()` | ✅ |
| GET /v1/salons/:salonId | get salon | `src/app/features/salons/salon-overview/salon-overview.component.ts` | `salonsControllerFindOne` | ✅ |
| PATCH /v1/salons/:salonId | update salon | `src/app/features/salons/salon-settings/salon-settings.component.ts` | `salonsControllerUpdate` in `save()` | ✅ |
| PATCH /v1/salons/:salonId/settings | update settings | `src/app/features/salons/salon-settings/salon-settings.component.ts` | `salonsControllerUpdateSettings` in `save()` | ✅ |
| PATCH /v1/salons/:salonId/slug | update slug | `src/app/features/salons/salon-slug/salon-slug.component.ts` | `salonsControllerUpdateSlug` in `save()` — handles `SALON_SLUG_TAKEN` inline | ✅ |
| DELETE /v1/salons/:salonId | soft delete | `src/app/features/salons/delete-salon/delete-salon.component.ts` | `salonsControllerSoftDelete` in `confirmDelete()` | ✅ |
| GET /v1/salons/slug/:slug | public slug lookup | `src/app/features/visit/salon-visit/salon-visit.component.ts` | `publicSalonsControllerFindBySlug` in `_loadSalon()` | ✅ |
| GET /v1/salons/:salonId/me | my membership | `src/app/core/salon-context/membership.store.ts` | `salonMembershipControllerGetMyMembership` in `getMembership()` | ✅ |

---

## 4. Staff

| Backend Endpoint | Method | Frontend File | Function / Method | Status |
|---|---|---|---|---|
| GET /v1/salons/:salonId/staff | list staff | `src/app/features/staff/staff-list/staff-list.component.ts` | `staffControllerFindAll` in `ngOnInit()` | ✅ |
| POST /v1/salons/:salonId/staff/invite | invite | `src/app/features/staff/invite-staff/invite-staff.component.ts` | `staffControllerInvite` in `invite()` — handles `STAFF_ALREADY_INVITED` inline | ✅ |
| PATCH /v1/salons/:salonId/staff/:staffId/role | change role | `src/app/features/staff/staff-detail/staff-detail.component.ts` | `staffControllerUpdateRole` in `changeRole()` | ✅ |
| PATCH /v1/salons/:salonId/staff/transfer-ownership | transfer | `src/app/features/staff/staff-detail/staff-detail.component.ts` | `staffControllerTransferOwnership` in `transferOwnership()` | ✅ |
| DELETE /v1/salons/:salonId/staff/:staffId | remove | `src/app/features/staff/staff-detail/staff-detail.component.ts` | `staffControllerRemove` in `removeStaff()` | ✅ |
| POST /v1/salons/:salonId/staff/accept | accept invite | `src/app/features/dashboard/salon/pending-invites/pending-invites.component.ts` | `staffInviteControllerAccept` in `accept()` | ✅ |
| POST /v1/salons/:salonId/staff/decline | decline invite | `src/app/features/dashboard/salon/pending-invites/pending-invites.component.ts` | `staffInviteControllerDecline` in `decline()` | ✅ |

---

## 5. Services

| Backend Endpoint | Method | Frontend File | Function / Method | Status |
|---|---|---|---|---|
| GET /v1/salons/:salonId/services | list services | `src/app/features/services/service-list/service-list.component.ts` | `publicServicesControllerFindBySalon` in `_load()` | ✅ |
| POST /v1/salons/:salonId/services | create service | `src/app/features/services/service-form/service-form.component.ts` | `servicesControllerCreate` in `save()` | ✅ |
| PATCH /v1/salons/:salonId/services/:serviceId | update service | `src/app/features/services/service-form/service-form.component.ts` | `servicesControllerUpdate` in `save()` | ✅ |
| DELETE /v1/salons/:salonId/services/:serviceId | deactivate | `src/app/features/services/service-list/service-list.component.ts` | `servicesControllerDeactivate` in `deactivate()` | ✅ |
| GET /v1/salons/:salonId/staff/:staffId/services | assigned services | `src/app/features/services/staff-service-assign/staff-service-assign.component.ts` | `staffServicesControllerGetStaffServices` in `ngOnInit()` | ✅ |
| POST /v1/salons/:salonId/staff/:staffId/services/:serviceId | assign service | `src/app/features/services/staff-service-assign/staff-service-assign.component.ts` | `staffServicesControllerAssignService` in `toggle()` | ✅ |
| DELETE /v1/salons/:salonId/staff/:staffId/services/:serviceId | remove service | `src/app/features/services/staff-service-assign/staff-service-assign.component.ts` | `staffServicesControllerRemoveService` in `toggle()` | ✅ |
| PATCH /v1/salons/:salonId/staff/:staffId/default-service | set default | `src/app/features/services/staff-service-assign/staff-service-assign.component.ts` | `staffServicesControllerSetDefaultService` in `setDefault()` | ✅ |

---

## 6. Schedules

| Backend Endpoint | Method | Frontend File | Function / Method | Status |
|---|---|---|---|---|
| GET /v1/salons/:salonId/staff/:staffId/schedules | list schedules | `src/app/features/schedules/weekly-schedule.component.ts` | `schedulesControllerFindAll` in `ngOnInit()` | ✅ |
| POST /v1/salons/:salonId/staff/:staffId/schedules | create day | `src/app/features/schedules/weekly-schedule.component.ts` | `schedulesControllerCreate` in `saveAdd()` | ✅ |
| PATCH /v1/salons/:salonId/staff/:staffId/schedules/:scheduleId | update day | `src/app/features/schedules/weekly-schedule.component.ts` | `schedulesControllerUpdate` in `saveEdit()` | ✅ |
| DELETE /v1/salons/:salonId/staff/:staffId/schedules/:scheduleId | delete day | `src/app/features/schedules/weekly-schedule.component.ts` | `schedulesControllerDelete` in `deleteSchedule()` | ✅ |

---

## 7. Closures

| Backend Endpoint | Method | Frontend File | Function / Method | Status |
|---|---|---|---|---|
| GET /v1/salons/:salonId/closures | salon closures | `src/app/features/closures/closures.component.ts` | `salonClosuresControllerFindAll` in `_loadSalon()` | ✅ |
| POST /v1/salons/:salonId/closures | add salon closure | `src/app/features/closures/closures.component.ts` | `salonClosuresControllerCreate` in `add()` | ✅ |
| DELETE /v1/salons/:salonId/closures/:closureId | remove salon closure | `src/app/features/closures/closures.component.ts` | `salonClosuresControllerDelete` in `delete()` | ✅ |
| GET /v1/salons/:salonId/staff/:staffId/closures | staff closures | `src/app/features/closures/closures.component.ts` | `staffClosuresControllerFindAll` in `_loadStaff()` | ✅ |
| POST /v1/salons/:salonId/staff/:staffId/closures | add staff closure | `src/app/features/closures/closures.component.ts` | `staffClosuresControllerCreate` in `add()` | ✅ |
| DELETE /v1/salons/:salonId/staff/:staffId/closures/:closureId | remove staff closure | `src/app/features/closures/closures.component.ts` | `staffClosuresControllerDelete` in `delete()` | ✅ |

---

## 8. Queues — Management (Staff Console)

| Backend Endpoint | Method | Frontend File | Function / Method | Status |
|---|---|---|---|---|
| GET /v1/queues/:queueId | get queue | `src/app/features/queue/queue-console/queue-console.component.ts` | `publicQueueControllerGetQueue` in `_loadQueueStatus()` | ✅ |
| GET /v1/queues/:queueId/timeline | initial timeline | `src/app/features/queue/queue-console/queue-console.component.ts` | `publicQueueControllerGetTimeline` in `_loadInitialTimeline()` | ✅ |
| PATCH /v1/salons/:salonId/queues/:queueId/status | set status | `src/app/features/queue/queue-console/queue-console.component.ts` | `queueManagementControllerSetStatus` in `setStatus()` | ✅ |
| POST /v1/salons/:salonId/queues/:queueId/call-next | call next | `src/app/features/queue/queue-console/queue-console.component.ts` | `queueManagementControllerCallNext` in `callNext()` — handles 409 resolve-flow | ✅ |
| PATCH /v1/salons/:salonId/queues/:queueId/entries/:entryId/members/:memberId/serve | serve member | `src/app/features/queue/queue-console/queue-console.component.ts` | `queueManagementControllerServeMember` in `serveMember()` | ✅ |
| PATCH /v1/salons/:salonId/queues/:queueId/entries/:entryId/members/:memberId/complete | complete member | `src/app/features/queue/queue-console/queue-console.component.ts` | `queueManagementControllerCompleteMember` in `endSession()` | ✅ |
| PATCH /v1/salons/:salonId/queues/:queueId/entries/:entryId/members/:memberId/extend | extend member | `src/app/features/queue/queue-console/queue-console.component.ts` | `queueManagementControllerExtendMember` in `extendMember()` | ✅ |
| PATCH /v1/salons/:salonId/queues/:queueId/entries/:entryId/no-show | no show | `src/app/features/queue/queue-console/queue-console.component.ts` | `queueManagementControllerMarkNoShow` in `noShow()` | ✅ |
| DELETE /v1/salons/:salonId/queues/:queueId/entries/:entryId | cancel entry | `src/app/features/queue/queue-console/queue-console.component.ts` | `queueManagementControllerCancelEntry` in `cancelEntry()` | ✅ |

---

## 9. Queues — Customer Walk-in (Visit Flow)

| Backend Endpoint | Method | Frontend File | Function / Method | Status |
|---|---|---|---|---|
| GET /v1/queues/:queueId | get queue status | `src/app/features/visit/salon-visit/salon-visit.component.ts` | `publicQueueControllerGetQueue` in `_loadQueueStatus()` | ✅ |
| GET /v1/queues/:queueId/timeline | public timeline | `src/app/features/visit/salon-visit/salon-visit.component.ts` | `publicQueueControllerGetTimeline` in `_loadInitialTimeline()` | ✅ |
| POST /v1/salons/:salonId/queues/:queueId/walk-in | join queue | `src/app/features/visit/salon-visit/salon-visit.component.ts` | `walkInControllerJoinQueue` in `joinQueue()` | ✅ |
| DELETE /v1/salons/:salonId/queues/:queueId/walk-in/:entryId | leave queue | `src/app/features/visit/salon-visit/salon-visit.component.ts` | `walkInControllerLeaveQueue` in `leaveQueue()` | ✅ |

---

## 10. WebSocket — QueueSocketService

**File:** `src/app/core/socket/queue-socket.service.ts`

| Contract | Implementation | Status |
|---|---|---|
| Connect to `/queues` namespace with JWT in auth payload | `io(environment.socketUrl + '/queues', { auth: { token } })` | ✅ |
| `joinQueue` emit | `watchQueue(queueId)` | ✅ |
| `joinQueueStaff` emit | `watchQueueAsStaff(queueId)` | ✅ |
| `leaveQueue` emit | `unwatchQueue(queueId)` | ✅ |
| `queueTimeline` event → Observable | `queueTimeline$(queueId)` — `ReplaySubject(1)` | ✅ |
| `customerCalled` event | `customerCalled$(queueId)` | ✅ |
| `connectionState$` | `connectionState$` Observable | ✅ |
| Reconnect re-join | `_rejoinAll()` re-emits `joinQueue`/`joinQueueStaff` on reconnect | ✅ |

---

## 11. Media

| Backend Endpoint | Method | Frontend File | Function / Method | Status |
|---|---|---|---|---|
| GET /v1/media/salon/:entityId | salon media | `src/app/features/salons/salon-media/salon-media.component.ts` | `publicMediaControllerGetSalonMedia` in `ngOnInit()` | ✅ |
| GET /v1/media/staff/:entityId | staff media | `src/app/features/staff/staff-media/staff-media.component.ts` | `publicMediaControllerGetStaffMedia` in `ngOnInit()` | ✅ |
| POST /v1/media/upload | upload | `src/app/shared/components/image-uploader/image-uploader.component.ts` | `ImageUploaderComponent` | ✅ |
| POST /v1/media/reorder | reorder gallery | `src/app/shared/components/gallery/gallery.component.ts` | `GalleryComponent` | ✅ |
| DELETE /v1/media/:mediaId | delete media | `src/app/shared/components/gallery/gallery.component.ts` | `GalleryComponent` — parent `onDeleted(id)` removes from signal | ✅ |

---

## 12. Notifications

| Backend Endpoint | Method | Frontend File | Function / Method | Status |
|---|---|---|---|---|
| GET /v1/notifications | inbox | `src/app/features/dashboard/salon/pending-invites/pending-invites.component.ts` | `notificationsControllerGetInbox` — filters `type === 'STAFF_INVITED'` | ✅ |

---

## 13. Core Infrastructure

| Concern | File | Status |
|---|---|---|
| Access token (in-memory signal) | `src/app/core/auth/token.store.ts` | ✅ |
| Refresh token (localStorage key `hm_refresh_token`) | `src/app/core/auth/token.store.ts` | ✅ |
| Session init on boot | `src/app/core/auth/session-init.ts` — refresh → `/auth/me` → hydrate | ✅ |
| JWT interceptor | `src/app/core/interceptors/jwt.interceptor.ts` | ✅ |
| Refresh interceptor | `src/app/core/interceptors/refresh.interceptor.ts` — single-flight, handles `TOKEN_EXPIRED` / `TOKEN_INVALID` | ✅ |
| Error interceptor | `src/app/core/interceptors/error.interceptor.ts` — branches on `code`; shows `body.message` for unhandled 4xx; shows `requestId` for 5xx | ✅ |
| `authGuard` | `src/app/core/guards/auth.guard.ts` | ✅ |
| MembershipStore | `src/app/core/salon-context/membership.store.ts` | ✅ |

---

## Open Items

None. All backend endpoints with frontend coverage are fully resolved.
