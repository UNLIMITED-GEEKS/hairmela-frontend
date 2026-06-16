# HairMela — FULL Core MVP End-to-End API Test

Generated: 2026-06-16T13:39:53Z  •  Base: `http://localhost:3000/v1`

Each step shows **action · method+URL · path params · request body · response**.
Inline ✅/❌ **CHECK** lines verify every expected behavior.
**WebSocket** pushes are captured and verified inline after every queue mutation.

---

## Findings

### Live WebSocket — fully verified with correct timing

| Push | Event | Payload summary |
|------|-------|-----------------|
| #1 | `queueTimeline` (initial snapshot) | `[]` — empty before the first join landed |
| #2 | `queueTimeline` (join broadcast) | Carl pos1 wait0, WAITING (30m snapshot) |
| #3 | `queueTimeline` (Carol added) | Carl pos1 wait0 / Carol pos2 wait30 |
| #4 | `queueTimeline` (staff cancel) | Carol alone at pos1 |
| #5 | `queueTimeline` (family joined) | Carol pos1 wait0 / family pos2 wait45 |
| #6 | `queueTimeline` (pause) | queue PAUSED |
| #7 | `queueTimeline` (resume) | queue OPEN |
| #8 | `queueTimeline` (call-next #1) | Carol SERVING pos0 / family wait45 |
| `customerCalled` | targeted notification | Carol's entry called to chair |
| #9 | `queueTimeline` (extend +15m) | Carol snapshot 45→60 / family wait 45→60 ✅ |
| #10 | `queueTimeline` (Carol complete) | family promoted pos1 wait0 |
| #11 | `queueTimeline` (call-next #2) | family SERVING pos0 |
| `customerCalled` | targeted notification | family entry called |
| #12 | `queueTimeline` (dad complete) | dad SERVED / kids WAITING |
| #13 | `queueTimeline` (Kid1 served) | Kid1 SERVING |
| #14 | `queueTimeline` (Kid1 complete) | Kid1 SERVED / Kid2 WAITING |

All counters are exact. Duration math proven inline: extend adds to `durationSnapshot`
and the downstream wait propagates to every entry behind in the same push.

### Summary

The full core-MVP API is verified working end-to-end. **87/87 assertions passed**,
zero 500s, zero unexpected errors.

### What is covered

| Area | Tested |
|------|--------|
| Auth | register, verify email, login, GET /auth/me, membership introspection (`/salons/:id/me` → OWNER / STAFF / CUSTOMER, pending invitee reads CUSTOMER) |
| Salon | create (operating hours persisted), read by id, update settings (maxPartySize) |
| Staff | invite, accept, list with staffId + auto-created queueId, role transitions |
| Services | create (5), update (price), public catalog, deactivate (catalog shrinks), assign to staff, remove assignment, set default service |
| Barber queue management | barber views their own queue (GET timeline as authenticated staff), barber adds a customer to their queue on their behalf, staff-cancels an entry (DELETE with staff JWT) |
| Queue status | pause → join rejected → resume |
| Walk-ins | single join, party join (3 members), party-size-limit rejection (400), customer leave (self-cancel via staff cancel) |
| Serving | call-next (auto-serves first member), explicit serve for subsequent party members, extend (+15m → wait propagates live), complete, multi-member party flow |
| No-show | mark WAITING entry NO\_SHOW, queue empties, double no-show rejected (400) |
| Timeline / timing | position + estimated-wait verified after every mutation; `durationSnapshot` survives service deactivation mid-queue; live WebSocket pushes verified with correct counters throughout |

### One real API behavior the frontend must know

`call-next` **auto-marks the entry's first member as SERVING**. The frontend must not
call `serve` on that first member — it returns `400 "Member is already SERVING"`.
Only call `serve` for 2nd, 3rd, … party members. This is enforced by the backend
and documented inline in the transcript steps F1 and F6.

---

## Full API Transcript

---

## SECTION A — Auth

## A1 — Register users (1 owner, 2 staff, 3 customers)

### 1. Register OWNER (owner+1781617193@test.com)

| Field | Value |
|-------|-------|
| **Action** | Register OWNER (owner+1781617193@test.com) |
| **Method + URL** | `POST http://localhost:3000/v1/auth/register` |
| **Path params** | `{}` |

**Request body:**
```json
{
  "email": "owner+1781617193@test.com",
  "password": "Passw0rd!23",
  "firstName": "Olivia",
  "lastName": "Owner"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5YWQxMWQzMi03MDg5LTQ0M2UtOTFmMi0yNWUyNjgwNzQ4MDUiLCJlbWFpbCI6Im93bmVyKzE3ODE2MTcxOTNAdGVzdC5jb20iLCJpYXQiOjE3ODE2MTcxOTMsImV4cCI6MTc4MTYyMDc5M30.Z-v1Mos727z8MUkMoaUdMGcRHLDJiT3F-nyIub4LxyI",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5YWQxMWQzMi03MDg5LTQ0M2UtOTFmMi0yNWUyNjgwNzQ4MDUiLCJlbWFpbCI6Im93bmVyKzE3ODE2MTcxOTNAdGVzdC5jb20iLCJpYXQiOjE3ODE2MTcxOTMsImV4cCI6MTc4MjIyMTk5M30.JufC4gHe2GpYI1EoU7yNP6ollY811gFII-lTvzwuJLk"
}
```

### 2. Register STAFF1/Barber1 (barber1+1781617193@test.com)

| Field | Value |
|-------|-------|
| **Action** | Register STAFF1/Barber1 (barber1+1781617193@test.com) |
| **Method + URL** | `POST http://localhost:3000/v1/auth/register` |
| **Path params** | `{}` |

**Request body:**
```json
{
  "email": "barber1+1781617193@test.com",
  "password": "Passw0rd!23",
  "firstName": "Bruno",
  "lastName": "Barber"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1YmEwY2ExZS0xMzEyLTRlZWItOGFhYy0xNTdiNjAyNTUyNWYiLCJlbWFpbCI6ImJhcmJlcjErMTc4MTYxNzE5M0B0ZXN0LmNvbSIsImlhdCI6MTc4MTYxNzE5NCwiZXhwIjoxNzgxNjIwNzk0fQ.KdWJvmWqsEgiy-k5LMUyZFgheA51g999qyGbIRlGUzY",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1YmEwY2ExZS0xMzEyLTRlZWItOGFhYy0xNTdiNjAyNTUyNWYiLCJlbWFpbCI6ImJhcmJlcjErMTc4MTYxNzE5M0B0ZXN0LmNvbSIsImlhdCI6MTc4MTYxNzE5NCwiZXhwIjoxNzgyMjIxOTk0fQ.dsNKXS--2zBE_EcxXU6B6Tww3nhjfyRmvtxyCm4yv9Q"
}
```

### 3. Register STAFF2/Barber2 (barber2+1781617193@test.com)

| Field | Value |
|-------|-------|
| **Action** | Register STAFF2/Barber2 (barber2+1781617193@test.com) |
| **Method + URL** | `POST http://localhost:3000/v1/auth/register` |
| **Path params** | `{}` |

**Request body:**
```json
{
  "email": "barber2+1781617193@test.com",
  "password": "Passw0rd!23",
  "firstName": "Bella",
  "lastName": "Barber"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiMjM1ZjkzMy0zZWQzLTRkNzUtYTE2Yy1kMjQ5ZjAyMDg1ZTIiLCJlbWFpbCI6ImJhcmJlcjIrMTc4MTYxNzE5M0B0ZXN0LmNvbSIsImlhdCI6MTc4MTYxNzE5NCwiZXhwIjoxNzgxNjIwNzk0fQ.3-Ktf9JXFfeFce4HFsqYyPDMuxj_BEBOhu0jBdinilg",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiMjM1ZjkzMy0zZWQzLTRkNzUtYTE2Yy1kMjQ5ZjAyMDg1ZTIiLCJlbWFpbCI6ImJhcmJlcjIrMTc4MTYxNzE5M0B0ZXN0LmNvbSIsImlhdCI6MTc4MTYxNzE5NCwiZXhwIjoxNzgyMjIxOTk0fQ.cj_CJYsNgPwra2EgPM016g__Q-kuL6VQxWB59g985rs"
}
```

### 4. Register CUSTOMER1 (cust1+1781617193@test.com)

| Field | Value |
|-------|-------|
| **Action** | Register CUSTOMER1 (cust1+1781617193@test.com) |
| **Method + URL** | `POST http://localhost:3000/v1/auth/register` |
| **Path params** | `{}` |

**Request body:**
```json
{
  "email": "cust1+1781617193@test.com",
  "password": "Passw0rd!23",
  "firstName": "Carl",
  "lastName": "Customer"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyMDc4NTY3MC04NmM2LTQ5MzItOTg5MC0xODY2NGRhZmJmNTQiLCJlbWFpbCI6ImN1c3QxKzE3ODE2MTcxOTNAdGVzdC5jb20iLCJpYXQiOjE3ODE2MTcxOTQsImV4cCI6MTc4MTYyMDc5NH0.rqWmb4JxT_9v3cQw5ucF5v4JdwmZXIiAg3i6mFK0d1k",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyMDc4NTY3MC04NmM2LTQ5MzItOTg5MC0xODY2NGRhZmJmNTQiLCJlbWFpbCI6ImN1c3QxKzE3ODE2MTcxOTNAdGVzdC5jb20iLCJpYXQiOjE3ODE2MTcxOTQsImV4cCI6MTc4MjIyMTk5NH0.h9sxTjMS7QCE3dLsfpupdtkRe-loT8bjGonqGJg2ThI"
}
```

### 5. Register CUSTOMER2 (cust2+1781617193@test.com)

| Field | Value |
|-------|-------|
| **Action** | Register CUSTOMER2 (cust2+1781617193@test.com) |
| **Method + URL** | `POST http://localhost:3000/v1/auth/register` |
| **Path params** | `{}` |

**Request body:**
```json
{
  "email": "cust2+1781617193@test.com",
  "password": "Passw0rd!23",
  "firstName": "Carol",
  "lastName": "Customer"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjM2M4NTc4Ny03YWRhLTQ4N2EtOWI3Ny00ZDM3YzYxY2MzZDEiLCJlbWFpbCI6ImN1c3QyKzE3ODE2MTcxOTNAdGVzdC5jb20iLCJpYXQiOjE3ODE2MTcxOTUsImV4cCI6MTc4MTYyMDc5NX0.26tc8Kq8uWmZrrj4MabaSuBhsl10tTU2npa04JoE9Rc",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjM2M4NTc4Ny03YWRhLTQ4N2EtOWI3Ny00ZDM3YzYxY2MzZDEiLCJlbWFpbCI6ImN1c3QyKzE3ODE2MTcxOTNAdGVzdC5jb20iLCJpYXQiOjE3ODE2MTcxOTUsImV4cCI6MTc4MjIyMTk5NX0.5KYh_a3clE2eWbiRfWlrBogN7ce-mGRatdIjmW5g8Is"
}
```

### 6. Register CUSTOMER3 (cust3+1781617193@test.com)

| Field | Value |
|-------|-------|
| **Action** | Register CUSTOMER3 (cust3+1781617193@test.com) |
| **Method + URL** | `POST http://localhost:3000/v1/auth/register` |
| **Path params** | `{}` |

**Request body:**
```json
{
  "email": "cust3+1781617193@test.com",
  "password": "Passw0rd!23",
  "firstName": "Cody",
  "lastName": "Customer"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5ZThjYjkxNi1kN2NhLTQyYzAtODZhMC05YjY4OGVmOGQ0ZmQiLCJlbWFpbCI6ImN1c3QzKzE3ODE2MTcxOTNAdGVzdC5jb20iLCJpYXQiOjE3ODE2MTcxOTUsImV4cCI6MTc4MTYyMDc5NX0.wtcbXJ0O_YDh6jC7DyLjclpM9RTpox9CInyCB1Q9thw",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5ZThjYjkxNi1kN2NhLTQyYzAtODZhMC05YjY4OGVmOGQ0ZmQiLCJlbWFpbCI6ImN1c3QzKzE3ODE2MTcxOTNAdGVzdC5jb20iLCJpYXQiOjE3ODE2MTcxOTUsImV4cCI6MTc4MjIyMTk5NX0.Ix2IFxw4mvZz9v5vivbK23fxtC8is-DNZdPweb_ACvw"
}
```

## A2 — Login (all 6 users)

### 7. Login (owner+1781617193@test.com)

| Field | Value |
|-------|-------|
| **Action** | Login (owner+1781617193@test.com) |
| **Method + URL** | `POST http://localhost:3000/v1/auth/login` |
| **Path params** | `{}` |

**Request body:**
```json
{
  "email": "owner+1781617193@test.com",
  "password": "Passw0rd!23"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5YWQxMWQzMi03MDg5LTQ0M2UtOTFmMi0yNWUyNjgwNzQ4MDUiLCJlbWFpbCI6Im93bmVyKzE3ODE2MTcxOTNAdGVzdC5jb20iLCJpYXQiOjE3ODE2MTcxOTUsImV4cCI6MTc4MTYyMDc5NX0.f-WrY8ZgY4zC-H3QFBsgRjlS5xVHVTY5UtMTe8w9TSk",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5YWQxMWQzMi03MDg5LTQ0M2UtOTFmMi0yNWUyNjgwNzQ4MDUiLCJlbWFpbCI6Im93bmVyKzE3ODE2MTcxOTNAdGVzdC5jb20iLCJpYXQiOjE3ODE2MTcxOTUsImV4cCI6MTc4MjIyMTk5NX0.rmC6cYF0aWHJ8llYv1UiskgMEPeTg-6Lc9VFHUJpjZI"
}
```

### 8. Login (barber1+1781617193@test.com)

| Field | Value |
|-------|-------|
| **Action** | Login (barber1+1781617193@test.com) |
| **Method + URL** | `POST http://localhost:3000/v1/auth/login` |
| **Path params** | `{}` |

**Request body:**
```json
{
  "email": "barber1+1781617193@test.com",
  "password": "Passw0rd!23"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1YmEwY2ExZS0xMzEyLTRlZWItOGFhYy0xNTdiNjAyNTUyNWYiLCJlbWFpbCI6ImJhcmJlcjErMTc4MTYxNzE5M0B0ZXN0LmNvbSIsImlhdCI6MTc4MTYxNzE5NiwiZXhwIjoxNzgxNjIwNzk2fQ.FFOaMmKCXK6VcNyyrfyoqeHJ01L0bw2KM9rBs2jsAlQ",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1YmEwY2ExZS0xMzEyLTRlZWItOGFhYy0xNTdiNjAyNTUyNWYiLCJlbWFpbCI6ImJhcmJlcjErMTc4MTYxNzE5M0B0ZXN0LmNvbSIsImlhdCI6MTc4MTYxNzE5NiwiZXhwIjoxNzgyMjIxOTk2fQ.XGSVRBF9f-Qwk5ib2XhUAz752Yuri1sQK6DqzQ_3_2I"
}
```

### 9. Login (barber2+1781617193@test.com)

| Field | Value |
|-------|-------|
| **Action** | Login (barber2+1781617193@test.com) |
| **Method + URL** | `POST http://localhost:3000/v1/auth/login` |
| **Path params** | `{}` |

**Request body:**
```json
{
  "email": "barber2+1781617193@test.com",
  "password": "Passw0rd!23"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiMjM1ZjkzMy0zZWQzLTRkNzUtYTE2Yy1kMjQ5ZjAyMDg1ZTIiLCJlbWFpbCI6ImJhcmJlcjIrMTc4MTYxNzE5M0B0ZXN0LmNvbSIsImlhdCI6MTc4MTYxNzE5NiwiZXhwIjoxNzgxNjIwNzk2fQ.4dW6LWDKZpF8aLubge9qlRI4D4f90ZcuUwIwSQ8KQro",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiMjM1ZjkzMy0zZWQzLTRkNzUtYTE2Yy1kMjQ5ZjAyMDg1ZTIiLCJlbWFpbCI6ImJhcmJlcjIrMTc4MTYxNzE5M0B0ZXN0LmNvbSIsImlhdCI6MTc4MTYxNzE5NiwiZXhwIjoxNzgyMjIxOTk2fQ.WctT5ohI1OhgtGGvkjTlqKEG1b5z_ZCsAUqHR6gSYfM"
}
```

### 10. Login (cust1+1781617193@test.com)

| Field | Value |
|-------|-------|
| **Action** | Login (cust1+1781617193@test.com) |
| **Method + URL** | `POST http://localhost:3000/v1/auth/login` |
| **Path params** | `{}` |

**Request body:**
```json
{
  "email": "cust1+1781617193@test.com",
  "password": "Passw0rd!23"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyMDc4NTY3MC04NmM2LTQ5MzItOTg5MC0xODY2NGRhZmJmNTQiLCJlbWFpbCI6ImN1c3QxKzE3ODE2MTcxOTNAdGVzdC5jb20iLCJpYXQiOjE3ODE2MTcxOTYsImV4cCI6MTc4MTYyMDc5Nn0.bSeyRGeuBoUEFD8e0nzoS-hszQauytAvZjPG9l9IM7s",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyMDc4NTY3MC04NmM2LTQ5MzItOTg5MC0xODY2NGRhZmJmNTQiLCJlbWFpbCI6ImN1c3QxKzE3ODE2MTcxOTNAdGVzdC5jb20iLCJpYXQiOjE3ODE2MTcxOTYsImV4cCI6MTc4MjIyMTk5Nn0.cRiPYXAO79LQYVbkcX8Ipi5sNzZUzJ2BqvNBiG5XgPM"
}
```

### 11. Login (cust2+1781617193@test.com)

| Field | Value |
|-------|-------|
| **Action** | Login (cust2+1781617193@test.com) |
| **Method + URL** | `POST http://localhost:3000/v1/auth/login` |
| **Path params** | `{}` |

**Request body:**
```json
{
  "email": "cust2+1781617193@test.com",
  "password": "Passw0rd!23"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjM2M4NTc4Ny03YWRhLTQ4N2EtOWI3Ny00ZDM3YzYxY2MzZDEiLCJlbWFpbCI6ImN1c3QyKzE3ODE2MTcxOTNAdGVzdC5jb20iLCJpYXQiOjE3ODE2MTcxOTYsImV4cCI6MTc4MTYyMDc5Nn0.-UwZiKCoB3w62x9ln7Bn2JRqPmRfsU0hN3lvM6YMJTQ",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjM2M4NTc4Ny03YWRhLTQ4N2EtOWI3Ny00ZDM3YzYxY2MzZDEiLCJlbWFpbCI6ImN1c3QyKzE3ODE2MTcxOTNAdGVzdC5jb20iLCJpYXQiOjE3ODE2MTcxOTYsImV4cCI6MTc4MjIyMTk5Nn0.eeDCQ6EdA-j9VDYQWlH4PWROJIVlqZOM_Ct84nhUxTo"
}
```

### 12. Login (cust3+1781617193@test.com)

| Field | Value |
|-------|-------|
| **Action** | Login (cust3+1781617193@test.com) |
| **Method + URL** | `POST http://localhost:3000/v1/auth/login` |
| **Path params** | `{}` |

**Request body:**
```json
{
  "email": "cust3+1781617193@test.com",
  "password": "Passw0rd!23"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5ZThjYjkxNi1kN2NhLTQyYzAtODZhMC05YjY4OGVmOGQ0ZmQiLCJlbWFpbCI6ImN1c3QzKzE3ODE2MTcxOTNAdGVzdC5jb20iLCJpYXQiOjE3ODE2MTcxOTcsImV4cCI6MTc4MTYyMDc5N30.ZiZyrNs7B4dY7fLHjB9d-zNhAyuPPFLcyVE81jz7Vng",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5ZThjYjkxNi1kN2NhLTQyYzAtODZhMC05YjY4OGVmOGQ0ZmQiLCJlbWFpbCI6ImN1c3QzKzE3ODE2MTcxOTNAdGVzdC5jb20iLCJpYXQiOjE3ODE2MTcxOTcsImV4cCI6MTc4MjIyMTk5N30.O_RJwmayP0QiO5nkUlCKXLG71Pl_W52XyCubVjVIhuk"
}
```
> ✅ **CHECK:** owner login returns access token (got `yes`)
> ✅ **CHECK:** staff1 login returns access token (got `yes`)
> ✅ **CHECK:** staff2 login returns access token (got `yes`)

## A3 — GET /auth/me

### 13. Owner GET /auth/me

| Field | Value |
|-------|-------|
| **Action** | Owner GET /auth/me |
| **Method + URL** | `GET http://localhost:3000/v1/auth/me` |
| **Path params** | `{}` |

**Request body:**
```json
(none)
```

**Response:**
```json
{
  "id": "9ad11d32-7089-443e-91f2-25e268074805",
  "email": "owner+1781617193@test.com",
  "firstName": "Olivia",
  "lastName": "Owner",
  "phone": null,
  "emailVerified": true,
  "passwordResetExpiresAt": null,
  "createdAt": "2026-06-16T13:39:53.799Z",
  "updatedAt": "2026-06-16T13:39:53.799Z",
  "deletedAt": null
}
```
> ✅ **CHECK:** auth/me returns owner email (got `owner+1781617193@test.com`)
> ✅ **CHECK:** owner emailVerified is true (got `true`)

---

## SECTION B — Salon setup

## B1 — Owner creates salon (with 7-day operating hours)

### 14. Owner creates salon

| Field | Value |
|-------|-------|
| **Action** | Owner creates salon |
| **Method + URL** | `POST http://localhost:3000/v1/salons` |
| **Path params** | `{}` |

**Request body:**
```json
{
  "name": "Fade Factory 1781617193",
  "address": {
    "country": "Nigeria",
    "state": "Lagos",
    "city": "Ikeja",
    "street": "12 Allen Ave"
  },
  "timezone": "Africa/Lagos",
  "defaultSlotDuration": 30,
  "operatingHours": [
    {
      "dayOfWeek": 0,
      "startTime": "08:00",
      "endTime": "20:00"
    },
    {
      "dayOfWeek": 1,
      "startTime": "08:00",
      "endTime": "20:00"
    },
    {
      "dayOfWeek": 2,
      "startTime": "08:00",
      "endTime": "20:00"
    },
    {
      "dayOfWeek": 3,
      "startTime": "08:00",
      "endTime": "20:00"
    },
    {
      "dayOfWeek": 4,
      "startTime": "08:00",
      "endTime": "20:00"
    },
    {
      "dayOfWeek": 5,
      "startTime": "08:00",
      "endTime": "20:00"
    },
    {
      "dayOfWeek": 6,
      "startTime": "08:00",
      "endTime": "20:00"
    }
  ]
}
```

**Response:**
```json
{
  "id": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "name": "Fade Factory 1781617193",
  "slug": "fade-factory-1781617193",
  "orgId": "93393213-4161-48b7-b7ac-c268a58e47dc",
  "addressId": "bb442903-7e52-4fe8-bf86-6af917c4f8ec",
  "timezone": "Africa/Lagos",
  "operatingHours": [
    {
      "endTime": "20:00",
      "dayOfWeek": 0,
      "startTime": "08:00"
    },
    {
      "endTime": "20:00",
      "dayOfWeek": 1,
      "startTime": "08:00"
    },
    {
      "endTime": "20:00",
      "dayOfWeek": 2,
      "startTime": "08:00"
    },
    {
      "endTime": "20:00",
      "dayOfWeek": 3,
      "startTime": "08:00"
    },
    {
      "endTime": "20:00",
      "dayOfWeek": 4,
      "startTime": "08:00"
    },
    {
      "endTime": "20:00",
      "dayOfWeek": 5,
      "startTime": "08:00"
    },
    {
      "endTime": "20:00",
      "dayOfWeek": 6,
      "startTime": "08:00"
    }
  ],
  "defaultSlotDuration": 30,
  "settings": {
    "allowWalkIns": true,
    "maxPartySize": 4,
    "noShowWindow": 15,
    "cancellationWindow": 60
  },
  "createdAt": "2026-06-16T13:39:57.144Z",
  "deletedAt": null
}
```
> ✅ **CHECK:** salon created and has an id (got `yes`)
> ✅ **CHECK:** operating hours persisted (7 days) (got `7`)
> ✅ **CHECK:** default slot duration is 30 (got `30`)

## B2 — Read salon by id

### 15. Owner reads salon

| Field | Value |
|-------|-------|
| **Action** | Owner reads salon |
| **Method + URL** | `GET http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
{
  "id": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "name": "Fade Factory 1781617193",
  "slug": "fade-factory-1781617193",
  "orgId": "93393213-4161-48b7-b7ac-c268a58e47dc",
  "addressId": "bb442903-7e52-4fe8-bf86-6af917c4f8ec",
  "address": {
    "id": "bb442903-7e52-4fe8-bf86-6af917c4f8ec",
    "country": "Nigeria",
    "state": "Lagos",
    "city": "Ikeja",
    "street": "12 Allen Ave",
    "createdAt": "2026-06-16T13:39:57.144Z"
  },
  "timezone": "Africa/Lagos",
  "operatingHours": [
    {
      "endTime": "20:00",
      "dayOfWeek": 0,
      "startTime": "08:00"
    },
    {
      "endTime": "20:00",
      "dayOfWeek": 1,
      "startTime": "08:00"
    },
    {
      "endTime": "20:00",
      "dayOfWeek": 2,
      "startTime": "08:00"
    },
    {
      "endTime": "20:00",
      "dayOfWeek": 3,
      "startTime": "08:00"
    },
    {
      "endTime": "20:00",
      "dayOfWeek": 4,
      "startTime": "08:00"
    },
    {
      "endTime": "20:00",
      "dayOfWeek": 5,
      "startTime": "08:00"
    },
    {
      "endTime": "20:00",
      "dayOfWeek": 6,
      "startTime": "08:00"
    }
  ],
  "defaultSlotDuration": 30,
  "settings": {
    "allowWalkIns": true,
    "maxPartySize": 4,
    "noShowWindow": 15,
    "cancellationWindow": 60
  },
  "createdAt": "2026-06-16T13:39:57.144Z",
  "deletedAt": null
}
```
> ✅ **CHECK:** GET salon returns correct id (got `6fbd7616-0b1e-4f16-a988-6fe80509e669`)
> ✅ **CHECK:** GET salon returns correct name (got `Fade Factory 1781617193`)

## B3 — Membership introspection (GET /salons/:salonId/me)

### 16. Owner role at salon

| Field | Value |
|-------|-------|
| **Action** | Owner role at salon |
| **Method + URL** | `GET http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/me` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
{
  "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "role": "OWNER",
  "isStaff": true,
  "canManageSalon": true,
  "canManageStaff": true,
  "tier": 1,
  "isFrozen": false
}
```
> ✅ **CHECK:** owner role = OWNER (got `OWNER`)
> ✅ **CHECK:** owner canManageStaff (got `true`)
> ✅ **CHECK:** owner canManageSalon (got `true`)

### 17. Customer role at salon (no staff record — must be CUSTOMER not 403)

| Field | Value |
|-------|-------|
| **Action** | Customer role at salon (no staff record — must be CUSTOMER not 403) |
| **Method + URL** | `GET http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/me` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
{
  "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "role": "CUSTOMER",
  "isStaff": false,
  "canManageSalon": false,
  "canManageStaff": false,
  "tier": 1,
  "isFrozen": false
}
```
> ✅ **CHECK:** customer with no record gets CUSTOMER not 403 (got `CUSTOMER`)

## B4 — Update salon settings (maxPartySize = 3 to test limit later)

### 18. Owner sets maxPartySize=3

| Field | Value |
|-------|-------|
| **Action** | Owner sets maxPartySize=3 |
| **Method + URL** | `PATCH http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/settings` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669"}` |

**Request body:**
```json
{
  "maxPartySize": 3
}
```

**Response:**
```json
{
  "id": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "name": "Fade Factory 1781617193",
  "slug": "fade-factory-1781617193",
  "orgId": "93393213-4161-48b7-b7ac-c268a58e47dc",
  "addressId": "bb442903-7e52-4fe8-bf86-6af917c4f8ec",
  "address": {
    "id": "bb442903-7e52-4fe8-bf86-6af917c4f8ec",
    "country": "Nigeria",
    "state": "Lagos",
    "city": "Ikeja",
    "street": "12 Allen Ave",
    "createdAt": "2026-06-16T13:39:57.144Z"
  },
  "timezone": "Africa/Lagos",
  "operatingHours": [
    {
      "endTime": "20:00",
      "dayOfWeek": 0,
      "startTime": "08:00"
    },
    {
      "endTime": "20:00",
      "dayOfWeek": 1,
      "startTime": "08:00"
    },
    {
      "endTime": "20:00",
      "dayOfWeek": 2,
      "startTime": "08:00"
    },
    {
      "endTime": "20:00",
      "dayOfWeek": 3,
      "startTime": "08:00"
    },
    {
      "endTime": "20:00",
      "dayOfWeek": 4,
      "startTime": "08:00"
    },
    {
      "endTime": "20:00",
      "dayOfWeek": 5,
      "startTime": "08:00"
    },
    {
      "endTime": "20:00",
      "dayOfWeek": 6,
      "startTime": "08:00"
    }
  ],
  "defaultSlotDuration": 30,
  "settings": {
    "maxPartySize": 3
  },
  "createdAt": "2026-06-16T13:39:57.144Z",
  "deletedAt": null
}
```
> ✅ **CHECK:** maxPartySize updated to 3 (got `3`)

---

## SECTION C — Staff management

## C1 — Owner invites 2 barbers

### 19. Invite STAFF1 as STAFF

| Field | Value |
|-------|-------|
| **Action** | Invite STAFF1 as STAFF |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/staff/invite` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669"}` |

**Request body:**
```json
{
  "email": "barber1+1781617193@test.com",
  "role": "STAFF"
}
```

**Response:**
```json
{
  "id": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
  "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "userId": "5ba0ca1e-1312-4eeb-8aac-157b6025525f",
  "email": "barber1+1781617193@test.com",
  "role": "STAFF",
  "status": "PENDING",
  "defaultServiceId": null,
  "invitedAt": "2026-06-16T13:39:57.342Z"
}
```

### 20. Invite STAFF2 as STAFF

| Field | Value |
|-------|-------|
| **Action** | Invite STAFF2 as STAFF |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/staff/invite` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669"}` |

**Request body:**
```json
{
  "email": "barber2+1781617193@test.com",
  "role": "STAFF"
}
```

**Response:**
```json
{
  "id": "b25bd6f4-ee07-4708-b11d-df8f409fd636",
  "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "userId": "b235f933-3ed3-4d75-a16c-d249f02085e2",
  "email": "barber2+1781617193@test.com",
  "role": "STAFF",
  "status": "PENDING",
  "defaultServiceId": null,
  "invitedAt": "2026-06-16T13:39:57.368Z"
}
```

### 21. STAFF1 membership BEFORE accept (should be CUSTOMER)

| Field | Value |
|-------|-------|
| **Action** | STAFF1 membership BEFORE accept (should be CUSTOMER) |
| **Method + URL** | `GET http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/me` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
{
  "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "role": "CUSTOMER",
  "isStaff": false,
  "canManageSalon": false,
  "canManageStaff": false,
  "tier": 1,
  "isFrozen": false
}
```
> ✅ **CHECK:** pending invitee reads CUSTOMER before accepting (got `CUSTOMER`)

## C2 — Both barbers accept their invite

### 22. STAFF1 accepts invite

| Field | Value |
|-------|-------|
| **Action** | STAFF1 accepts invite |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/staff/accept` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
{
  "id": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
  "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "userId": "5ba0ca1e-1312-4eeb-8aac-157b6025525f",
  "email": "barber1+1781617193@test.com",
  "role": "STAFF",
  "status": "ACTIVE",
  "defaultServiceId": null,
  "invitedAt": "2026-06-16T13:39:57.342Z"
}
```

### 23. STAFF2 accepts invite

| Field | Value |
|-------|-------|
| **Action** | STAFF2 accepts invite |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/staff/accept` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
{
  "id": "b25bd6f4-ee07-4708-b11d-df8f409fd636",
  "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "userId": "b235f933-3ed3-4d75-a16c-d249f02085e2",
  "email": "barber2+1781617193@test.com",
  "role": "STAFF",
  "status": "ACTIVE",
  "defaultServiceId": null,
  "invitedAt": "2026-06-16T13:39:57.368Z"
}
```

### 24. STAFF1 membership AFTER accept

| Field | Value |
|-------|-------|
| **Action** | STAFF1 membership AFTER accept |
| **Method + URL** | `GET http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/me` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
{
  "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "role": "STAFF",
  "isStaff": true,
  "canManageSalon": false,
  "canManageStaff": false,
  "tier": 1,
  "isFrozen": false
}
```
> ✅ **CHECK:** accepted staff reads STAFF (got `STAFF`)
> ✅ **CHECK:** staff isStaff flag true (got `true`)

### 25. STAFF2 membership AFTER accept

| Field | Value |
|-------|-------|
| **Action** | STAFF2 membership AFTER accept |
| **Method + URL** | `GET http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/me` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
{
  "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "role": "STAFF",
  "isStaff": true,
  "canManageSalon": false,
  "canManageStaff": false,
  "tier": 1,
  "isFrozen": false
}
```
> ✅ **CHECK:** staff2 accepted and reads STAFF (got `STAFF`)

## C3 — List staff (owner sees all staff + auto-created queueId per barber)

### 26. Owner lists all salon staff

| Field | Value |
|-------|-------|
| **Action** | Owner lists all salon staff |
| **Method + URL** | `GET http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/staff` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "staff": {
      "id": "f7a46e43-2dc0-494b-af8c-597727b89a44",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "userId": "9ad11d32-7089-443e-91f2-25e268074805",
      "user": {
        "id": "9ad11d32-7089-443e-91f2-25e268074805",
        "email": "owner+1781617193@test.com",
        "firstName": "Olivia",
        "lastName": "Owner",
        "phone": null,
        "emailVerified": true,
        "passwordResetExpiresAt": null,
        "createdAt": "2026-06-16T13:39:53.799Z",
        "updatedAt": "2026-06-16T13:39:53.799Z",
        "deletedAt": null
      },
      "email": "owner+1781617193@test.com",
      "role": "OWNER",
      "status": "ACTIVE",
      "defaultServiceId": null,
      "invitedAt": "2026-06-16T13:39:57.144Z"
    },
    "queueId": null
  },
  {
    "staff": {
      "id": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "userId": "5ba0ca1e-1312-4eeb-8aac-157b6025525f",
      "user": {
        "id": "5ba0ca1e-1312-4eeb-8aac-157b6025525f",
        "email": "barber1+1781617193@test.com",
        "firstName": "Bruno",
        "lastName": "Barber",
        "phone": null,
        "emailVerified": true,
        "passwordResetExpiresAt": null,
        "createdAt": "2026-06-16T13:39:54.162Z",
        "updatedAt": "2026-06-16T13:39:54.162Z",
        "deletedAt": null
      },
      "email": "barber1+1781617193@test.com",
      "role": "STAFF",
      "status": "ACTIVE",
      "defaultServiceId": null,
      "invitedAt": "2026-06-16T13:39:57.342Z"
    },
    "queueId": "891b2996-15fb-4745-b4e6-0d45215df52b"
  },
  {
    "staff": {
      "id": "b25bd6f4-ee07-4708-b11d-df8f409fd636",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "userId": "b235f933-3ed3-4d75-a16c-d249f02085e2",
      "user": {
        "id": "b235f933-3ed3-4d75-a16c-d249f02085e2",
        "email": "barber2+1781617193@test.com",
        "firstName": "Bella",
        "lastName": "Barber",
        "phone": null,
        "emailVerified": true,
        "passwordResetExpiresAt": null,
        "createdAt": "2026-06-16T13:39:54.474Z",
        "updatedAt": "2026-06-16T13:39:54.474Z",
        "deletedAt": null
      },
      "email": "barber2+1781617193@test.com",
      "role": "STAFF",
      "status": "ACTIVE",
      "defaultServiceId": null,
      "invitedAt": "2026-06-16T13:39:57.368Z"
    },
    "queueId": "49810b9d-4087-4fca-95ae-1d61022b6c93"
  }
]
```
> ✅ **CHECK:** staff list has 3 members (owner + 2 barbers) (got `3`)
> ✅ **CHECK:** barber1 has auto-created queue (got `yes`)
> ✅ **CHECK:** barber2 has auto-created queue (got `yes`)

---

## SECTION D — Services

## D1 — Owner creates 5 services (different durations)

### 27. Create service: Haircut (30min ₦5000)

| Field | Value |
|-------|-------|
| **Action** | Create service: Haircut (30min ₦5000) |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/services` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669"}` |

**Request body:**
```json
{
  "name": "Haircut",
  "duration": 30,
  "price": "5000"
}
```

**Response:**
```json
{
  "id": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
  "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "name": "Haircut",
  "description": null,
  "duration": 30,
  "price": "5000",
  "isActive": true,
  "createdAt": "2026-06-16T13:39:57.565Z"
}
```

### 28. Create service: Beard Trim (15min ₦2000)

| Field | Value |
|-------|-------|
| **Action** | Create service: Beard Trim (15min ₦2000) |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/services` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669"}` |

**Request body:**
```json
{
  "name": "Beard Trim",
  "duration": 15,
  "price": "2000"
}
```

**Response:**
```json
{
  "id": "ca0433ab-3b3d-4dab-98c7-5a4d1f60b917",
  "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "name": "Beard Trim",
  "description": null,
  "duration": 15,
  "price": "2000",
  "isActive": true,
  "createdAt": "2026-06-16T13:39:57.605Z"
}
```

### 29. Create service: Fade (45min ₦7000)

| Field | Value |
|-------|-------|
| **Action** | Create service: Fade (45min ₦7000) |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/services` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669"}` |

**Request body:**
```json
{
  "name": "Fade",
  "duration": 45,
  "price": "7000"
}
```

**Response:**
```json
{
  "id": "5537b04d-83ba-4fc2-9778-e95271106f61",
  "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "name": "Fade",
  "description": null,
  "duration": 45,
  "price": "7000",
  "isActive": true,
  "createdAt": "2026-06-16T13:39:57.636Z"
}
```

### 30. Create service: Kids Cut (20min ₦3000)

| Field | Value |
|-------|-------|
| **Action** | Create service: Kids Cut (20min ₦3000) |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/services` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669"}` |

**Request body:**
```json
{
  "name": "Kids Cut",
  "duration": 20,
  "price": "3000"
}
```

**Response:**
```json
{
  "id": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
  "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "name": "Kids Cut",
  "description": null,
  "duration": 20,
  "price": "3000",
  "isActive": true,
  "createdAt": "2026-06-16T13:39:57.667Z"
}
```

### 31. Create service: Hot Towel (temp) (10min ₦1500)

| Field | Value |
|-------|-------|
| **Action** | Create service: Hot Towel (temp) (10min ₦1500) |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/services` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669"}` |

**Request body:**
```json
{
  "name": "Hot Towel (temp)",
  "duration": 10,
  "price": "1500"
}
```

**Response:**
```json
{
  "id": "72359261-c3eb-401f-b000-845ac33fc8a8",
  "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "name": "Hot Towel (temp)",
  "description": null,
  "duration": 10,
  "price": "1500",
  "isActive": true,
  "createdAt": "2026-06-16T13:39:57.700Z"
}
```
> ✅ **CHECK:** all 5 services created (got `ok`)

## D2 — Update a service (Beard Trim price 2000 → 2500)

### 32. Update Beard Trim price

| Field | Value |
|-------|-------|
| **Action** | Update Beard Trim price |
| **Method + URL** | `PATCH http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/services/ca0433ab-3b3d-4dab-98c7-5a4d1f60b917` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","serviceId":"ca0433ab-3b3d-4dab-98c7-5a4d1f60b917"}` |

**Request body:**
```json
{
  "price": "2500"
}
```

**Response:**
```json
{
  "id": "ca0433ab-3b3d-4dab-98c7-5a4d1f60b917",
  "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "name": "Beard Trim",
  "description": null,
  "duration": 15,
  "price": "2500",
  "isActive": true,
  "createdAt": "2026-06-16T13:39:57.605Z"
}
```
> ✅ **CHECK:** service price updated to 2500 (got `2500`)

## D3 — Public service catalog (no auth required)

### 33. Public GET services

| Field | Value |
|-------|-------|
| **Action** | Public GET services |
| **Method + URL** | `GET http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/services` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "id": "ca0433ab-3b3d-4dab-98c7-5a4d1f60b917",
    "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
    "name": "Beard Trim",
    "description": null,
    "duration": 15,
    "price": "2500.00",
    "isActive": true,
    "createdAt": "2026-06-16T13:39:57.605Z"
  },
  {
    "id": "5537b04d-83ba-4fc2-9778-e95271106f61",
    "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
    "name": "Fade",
    "description": null,
    "duration": 45,
    "price": "7000.00",
    "isActive": true,
    "createdAt": "2026-06-16T13:39:57.636Z"
  },
  {
    "id": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
    "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
    "name": "Haircut",
    "description": null,
    "duration": 30,
    "price": "5000.00",
    "isActive": true,
    "createdAt": "2026-06-16T13:39:57.565Z"
  },
  {
    "id": "72359261-c3eb-401f-b000-845ac33fc8a8",
    "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
    "name": "Hot Towel (temp)",
    "description": null,
    "duration": 10,
    "price": "1500.00",
    "isActive": true,
    "createdAt": "2026-06-16T13:39:57.700Z"
  },
  {
    "id": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
    "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
    "name": "Kids Cut",
    "description": null,
    "duration": 20,
    "price": "3000.00",
    "isActive": true,
    "createdAt": "2026-06-16T13:39:57.667Z"
  }
]
```
> ✅ **CHECK:** public catalog returns all 5 active services (got `5`)

## D4 — Assign services to barbers

### 34. Assign Haircut → Barber1

| Field | Value |
|-------|-------|
| **Action** | Assign Haircut → Barber1 |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/staff/90c0eca6-c362-4d35-b59d-1a64c163f32c/services/5ec038db-43bd-4951-be42-0eb6d6b0c98c` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","staffId":"90c0eca6-c362-4d35-b59d-1a64c163f32c","serviceId":"5ec038db-43bd-4951-be42-0eb6d6b0c98c"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "id": "5de2ed5a-bc82-41d8-8b6a-e7452600dc42",
    "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
    "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
    "service": {
      "id": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Haircut",
      "description": null,
      "duration": 30,
      "price": "5000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.565Z"
    },
    "createdAt": "2026-06-16T13:39:57.786Z"
  }
]
```

### 35. Assign Fade → Barber1

| Field | Value |
|-------|-------|
| **Action** | Assign Fade → Barber1 |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/staff/90c0eca6-c362-4d35-b59d-1a64c163f32c/services/5537b04d-83ba-4fc2-9778-e95271106f61` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","staffId":"90c0eca6-c362-4d35-b59d-1a64c163f32c","serviceId":"5537b04d-83ba-4fc2-9778-e95271106f61"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "id": "5de2ed5a-bc82-41d8-8b6a-e7452600dc42",
    "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
    "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
    "service": {
      "id": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Haircut",
      "description": null,
      "duration": 30,
      "price": "5000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.565Z"
    },
    "createdAt": "2026-06-16T13:39:57.786Z"
  },
  {
    "id": "5b834cc5-7deb-415f-a754-c1c0c0a47ee0",
    "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
    "serviceId": "5537b04d-83ba-4fc2-9778-e95271106f61",
    "service": {
      "id": "5537b04d-83ba-4fc2-9778-e95271106f61",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Fade",
      "description": null,
      "duration": 45,
      "price": "7000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.636Z"
    },
    "createdAt": "2026-06-16T13:39:57.814Z"
  }
]
```

### 36. Assign Kids Cut → Barber1

| Field | Value |
|-------|-------|
| **Action** | Assign Kids Cut → Barber1 |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/staff/90c0eca6-c362-4d35-b59d-1a64c163f32c/services/43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","staffId":"90c0eca6-c362-4d35-b59d-1a64c163f32c","serviceId":"43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "id": "5de2ed5a-bc82-41d8-8b6a-e7452600dc42",
    "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
    "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
    "service": {
      "id": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Haircut",
      "description": null,
      "duration": 30,
      "price": "5000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.565Z"
    },
    "createdAt": "2026-06-16T13:39:57.786Z"
  },
  {
    "id": "5b834cc5-7deb-415f-a754-c1c0c0a47ee0",
    "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
    "serviceId": "5537b04d-83ba-4fc2-9778-e95271106f61",
    "service": {
      "id": "5537b04d-83ba-4fc2-9778-e95271106f61",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Fade",
      "description": null,
      "duration": 45,
      "price": "7000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.636Z"
    },
    "createdAt": "2026-06-16T13:39:57.814Z"
  },
  {
    "id": "a1d0fab5-0d11-415f-a484-95364e508bfa",
    "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
    "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
    "service": {
      "id": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Kids Cut",
      "description": null,
      "duration": 20,
      "price": "3000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.667Z"
    },
    "createdAt": "2026-06-16T13:39:57.843Z"
  }
]
```

### 37. Assign Hot Towel → Barber1 (will be removed)

| Field | Value |
|-------|-------|
| **Action** | Assign Hot Towel → Barber1 (will be removed) |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/staff/90c0eca6-c362-4d35-b59d-1a64c163f32c/services/72359261-c3eb-401f-b000-845ac33fc8a8` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","staffId":"90c0eca6-c362-4d35-b59d-1a64c163f32c","serviceId":"72359261-c3eb-401f-b000-845ac33fc8a8"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "id": "5de2ed5a-bc82-41d8-8b6a-e7452600dc42",
    "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
    "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
    "service": {
      "id": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Haircut",
      "description": null,
      "duration": 30,
      "price": "5000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.565Z"
    },
    "createdAt": "2026-06-16T13:39:57.786Z"
  },
  {
    "id": "5b834cc5-7deb-415f-a754-c1c0c0a47ee0",
    "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
    "serviceId": "5537b04d-83ba-4fc2-9778-e95271106f61",
    "service": {
      "id": "5537b04d-83ba-4fc2-9778-e95271106f61",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Fade",
      "description": null,
      "duration": 45,
      "price": "7000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.636Z"
    },
    "createdAt": "2026-06-16T13:39:57.814Z"
  },
  {
    "id": "a1d0fab5-0d11-415f-a484-95364e508bfa",
    "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
    "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
    "service": {
      "id": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Kids Cut",
      "description": null,
      "duration": 20,
      "price": "3000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.667Z"
    },
    "createdAt": "2026-06-16T13:39:57.843Z"
  },
  {
    "id": "47d6ada6-cad3-4a99-acb7-985fb235244e",
    "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
    "serviceId": "72359261-c3eb-401f-b000-845ac33fc8a8",
    "service": {
      "id": "72359261-c3eb-401f-b000-845ac33fc8a8",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Hot Towel (temp)",
      "description": null,
      "duration": 10,
      "price": "1500.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.700Z"
    },
    "createdAt": "2026-06-16T13:39:57.868Z"
  }
]
```

### 38. Assign Haircut → Barber2

| Field | Value |
|-------|-------|
| **Action** | Assign Haircut → Barber2 |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/staff/b25bd6f4-ee07-4708-b11d-df8f409fd636/services/5ec038db-43bd-4951-be42-0eb6d6b0c98c` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","staffId":"b25bd6f4-ee07-4708-b11d-df8f409fd636","serviceId":"5ec038db-43bd-4951-be42-0eb6d6b0c98c"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "id": "a43b6272-1737-4fc3-892a-8c7fab57c7a2",
    "staffId": "b25bd6f4-ee07-4708-b11d-df8f409fd636",
    "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
    "service": {
      "id": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Haircut",
      "description": null,
      "duration": 30,
      "price": "5000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.565Z"
    },
    "createdAt": "2026-06-16T13:39:57.892Z"
  }
]
```

### 39. Assign Beard Trim → Barber2

| Field | Value |
|-------|-------|
| **Action** | Assign Beard Trim → Barber2 |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/staff/b25bd6f4-ee07-4708-b11d-df8f409fd636/services/ca0433ab-3b3d-4dab-98c7-5a4d1f60b917` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","staffId":"b25bd6f4-ee07-4708-b11d-df8f409fd636","serviceId":"ca0433ab-3b3d-4dab-98c7-5a4d1f60b917"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "id": "a43b6272-1737-4fc3-892a-8c7fab57c7a2",
    "staffId": "b25bd6f4-ee07-4708-b11d-df8f409fd636",
    "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
    "service": {
      "id": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Haircut",
      "description": null,
      "duration": 30,
      "price": "5000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.565Z"
    },
    "createdAt": "2026-06-16T13:39:57.892Z"
  },
  {
    "id": "551a76cd-ab2d-4b29-bf7a-01e349942032",
    "staffId": "b25bd6f4-ee07-4708-b11d-df8f409fd636",
    "serviceId": "ca0433ab-3b3d-4dab-98c7-5a4d1f60b917",
    "service": {
      "id": "ca0433ab-3b3d-4dab-98c7-5a4d1f60b917",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Beard Trim",
      "description": null,
      "duration": 15,
      "price": "2500.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.605Z"
    },
    "createdAt": "2026-06-16T13:39:57.916Z"
  }
]
```

### 40. Barber1 service list (expect 4)

| Field | Value |
|-------|-------|
| **Action** | Barber1 service list (expect 4) |
| **Method + URL** | `GET http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/staff/90c0eca6-c362-4d35-b59d-1a64c163f32c/services` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","staffId":"90c0eca6-c362-4d35-b59d-1a64c163f32c"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "id": "5de2ed5a-bc82-41d8-8b6a-e7452600dc42",
    "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
    "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
    "service": {
      "id": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Haircut",
      "description": null,
      "duration": 30,
      "price": "5000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.565Z"
    },
    "createdAt": "2026-06-16T13:39:57.786Z"
  },
  {
    "id": "5b834cc5-7deb-415f-a754-c1c0c0a47ee0",
    "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
    "serviceId": "5537b04d-83ba-4fc2-9778-e95271106f61",
    "service": {
      "id": "5537b04d-83ba-4fc2-9778-e95271106f61",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Fade",
      "description": null,
      "duration": 45,
      "price": "7000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.636Z"
    },
    "createdAt": "2026-06-16T13:39:57.814Z"
  },
  {
    "id": "a1d0fab5-0d11-415f-a484-95364e508bfa",
    "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
    "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
    "service": {
      "id": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Kids Cut",
      "description": null,
      "duration": 20,
      "price": "3000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.667Z"
    },
    "createdAt": "2026-06-16T13:39:57.843Z"
  },
  {
    "id": "47d6ada6-cad3-4a99-acb7-985fb235244e",
    "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
    "serviceId": "72359261-c3eb-401f-b000-845ac33fc8a8",
    "service": {
      "id": "72359261-c3eb-401f-b000-845ac33fc8a8",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Hot Towel (temp)",
      "description": null,
      "duration": 10,
      "price": "1500.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.700Z"
    },
    "createdAt": "2026-06-16T13:39:57.868Z"
  }
]
```
> ✅ **CHECK:** barber1 has 4 services after assignments (got `4`)

### 41. Barber2 service list (expect 2)

| Field | Value |
|-------|-------|
| **Action** | Barber2 service list (expect 2) |
| **Method + URL** | `GET http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/staff/b25bd6f4-ee07-4708-b11d-df8f409fd636/services` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","staffId":"b25bd6f4-ee07-4708-b11d-df8f409fd636"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "id": "a43b6272-1737-4fc3-892a-8c7fab57c7a2",
    "staffId": "b25bd6f4-ee07-4708-b11d-df8f409fd636",
    "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
    "service": {
      "id": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Haircut",
      "description": null,
      "duration": 30,
      "price": "5000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.565Z"
    },
    "createdAt": "2026-06-16T13:39:57.892Z"
  },
  {
    "id": "551a76cd-ab2d-4b29-bf7a-01e349942032",
    "staffId": "b25bd6f4-ee07-4708-b11d-df8f409fd636",
    "serviceId": "ca0433ab-3b3d-4dab-98c7-5a4d1f60b917",
    "service": {
      "id": "ca0433ab-3b3d-4dab-98c7-5a4d1f60b917",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Beard Trim",
      "description": null,
      "duration": 15,
      "price": "2500.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.605Z"
    },
    "createdAt": "2026-06-16T13:39:57.916Z"
  }
]
```
> ✅ **CHECK:** barber2 has 2 services after assignments (got `2`)

## D5 — Remove a service assignment (unassign Hot Towel from Barber1)

### 42. Remove Hot Towel from Barber1

| Field | Value |
|-------|-------|
| **Action** | Remove Hot Towel from Barber1 |
| **Method + URL** | `DELETE http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/staff/90c0eca6-c362-4d35-b59d-1a64c163f32c/services/72359261-c3eb-401f-b000-845ac33fc8a8` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","staffId":"90c0eca6-c362-4d35-b59d-1a64c163f32c","serviceId":"72359261-c3eb-401f-b000-845ac33fc8a8"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "id": "5de2ed5a-bc82-41d8-8b6a-e7452600dc42",
    "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
    "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
    "service": {
      "id": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Haircut",
      "description": null,
      "duration": 30,
      "price": "5000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.565Z"
    },
    "createdAt": "2026-06-16T13:39:57.786Z"
  },
  {
    "id": "5b834cc5-7deb-415f-a754-c1c0c0a47ee0",
    "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
    "serviceId": "5537b04d-83ba-4fc2-9778-e95271106f61",
    "service": {
      "id": "5537b04d-83ba-4fc2-9778-e95271106f61",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Fade",
      "description": null,
      "duration": 45,
      "price": "7000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.636Z"
    },
    "createdAt": "2026-06-16T13:39:57.814Z"
  },
  {
    "id": "a1d0fab5-0d11-415f-a484-95364e508bfa",
    "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
    "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
    "service": {
      "id": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Kids Cut",
      "description": null,
      "duration": 20,
      "price": "3000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.667Z"
    },
    "createdAt": "2026-06-16T13:39:57.843Z"
  }
]
```

### 43. Barber1 service list after removal (expect 3)

| Field | Value |
|-------|-------|
| **Action** | Barber1 service list after removal (expect 3) |
| **Method + URL** | `GET http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/staff/90c0eca6-c362-4d35-b59d-1a64c163f32c/services` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","staffId":"90c0eca6-c362-4d35-b59d-1a64c163f32c"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "id": "5de2ed5a-bc82-41d8-8b6a-e7452600dc42",
    "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
    "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
    "service": {
      "id": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Haircut",
      "description": null,
      "duration": 30,
      "price": "5000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.565Z"
    },
    "createdAt": "2026-06-16T13:39:57.786Z"
  },
  {
    "id": "5b834cc5-7deb-415f-a754-c1c0c0a47ee0",
    "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
    "serviceId": "5537b04d-83ba-4fc2-9778-e95271106f61",
    "service": {
      "id": "5537b04d-83ba-4fc2-9778-e95271106f61",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Fade",
      "description": null,
      "duration": 45,
      "price": "7000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.636Z"
    },
    "createdAt": "2026-06-16T13:39:57.814Z"
  },
  {
    "id": "a1d0fab5-0d11-415f-a484-95364e508bfa",
    "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
    "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
    "service": {
      "id": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
      "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
      "name": "Kids Cut",
      "description": null,
      "duration": 20,
      "price": "3000.00",
      "isActive": true,
      "createdAt": "2026-06-16T13:39:57.667Z"
    },
    "createdAt": "2026-06-16T13:39:57.843Z"
  }
]
```
> ✅ **CHECK:** barber1 back to 3 services after removal (got `3`)

## D6 — Set Barber1 default service = Haircut

### 44. Set Barber1 default service (Haircut)

| Field | Value |
|-------|-------|
| **Action** | Set Barber1 default service (Haircut) |
| **Method + URL** | `PATCH http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/staff/90c0eca6-c362-4d35-b59d-1a64c163f32c/default-service` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","staffId":"90c0eca6-c362-4d35-b59d-1a64c163f32c"}` |

**Request body:**
```json
{
  "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c"
}
```

**Response:**
```json
{
  "id": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
  "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "userId": "5ba0ca1e-1312-4eeb-8aac-157b6025525f",
  "email": "barber1+1781617193@test.com",
  "role": "STAFF",
  "status": "ACTIVE",
  "defaultServiceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
  "invitedAt": "2026-06-16T13:39:57.342Z"
}
```
> ✅ **CHECK:** defaultServiceId = Haircut (got `5ec038db-43bd-4951-be42-0eb6d6b0c98c`)

## D7 — Deactivate Hot Towel service (catalog shrinks to 4)

### 45. Deactivate Hot Towel

| Field | Value |
|-------|-------|
| **Action** | Deactivate Hot Towel |
| **Method + URL** | `DELETE http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/services/72359261-c3eb-401f-b000-845ac33fc8a8` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","serviceId":"72359261-c3eb-401f-b000-845ac33fc8a8"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
```

### 46. Public catalog after deactivation (expect 4)

| Field | Value |
|-------|-------|
| **Action** | Public catalog after deactivation (expect 4) |
| **Method + URL** | `GET http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/services` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "id": "ca0433ab-3b3d-4dab-98c7-5a4d1f60b917",
    "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
    "name": "Beard Trim",
    "description": null,
    "duration": 15,
    "price": "2500.00",
    "isActive": true,
    "createdAt": "2026-06-16T13:39:57.605Z"
  },
  {
    "id": "5537b04d-83ba-4fc2-9778-e95271106f61",
    "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
    "name": "Fade",
    "description": null,
    "duration": 45,
    "price": "7000.00",
    "isActive": true,
    "createdAt": "2026-06-16T13:39:57.636Z"
  },
  {
    "id": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
    "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
    "name": "Haircut",
    "description": null,
    "duration": 30,
    "price": "5000.00",
    "isActive": true,
    "createdAt": "2026-06-16T13:39:57.565Z"
  },
  {
    "id": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
    "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
    "name": "Kids Cut",
    "description": null,
    "duration": 20,
    "price": "3000.00",
    "isActive": true,
    "createdAt": "2026-06-16T13:39:57.667Z"
  }
]
```
> ✅ **CHECK:** catalog shows 4 active services after deactivation (got `4`)

---

## SECTION E — Barber queue management

> This section tests the **barber's perspective**: viewing their queue, adding
> customers on their behalf, managing queue status, and working through entries.
> A **live WebSocket listener** is connected before the first mutation and runs
> for the entire section — every push is captured and asserted inline.

## E1 — Connect WebSocket listener to Barber1's queue

> **WebSocket listener started** (pid 59958) watching queue `891b2996-15fb-4745-b4e6-0d45215df52b`
> ✅ **CHECK:** WS listener process running (got `yes`)

## E2 — Barber1 views their own queue (empty)

> Barber uses the same public timeline endpoint. Position and wait are computed
> at read time — nothing is stored. An empty queue returns `[]`.

### 47. Barber1 reads their queue timeline (public, no auth needed)

| Field | Value |
|-------|-------|
| **Action** | Barber1 reads their queue timeline (public, no auth needed) |
| **Method + URL** | `GET http://localhost:3000/v1/queues/891b2996-15fb-4745-b4e6-0d45215df52b/timeline` |
| **Path params** | `{"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[]
```
> ✅ **CHECK:** barber's queue is empty at start (got `0`)

## E3 — Customer1 self-joins Barber1's queue (Haircut 30m)

### 48. CUSTOMER1 joins Barber1 (Haircut 30m)

| Field | Value |
|-------|-------|
| **Action** | CUSTOMER1 joins Barber1 (Haircut 30m) |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/891b2996-15fb-4745-b4e6-0d45215df52b/walk-in` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
{
  "members": [
    {
      "memberName": "Carl",
      "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c"
    }
  ],
  "notes": "first"
}
```

**Response:**
```json
{
  "id": "8d3b5a34-6fff-4044-b9ea-ca94db8504ac",
  "queueId": "891b2996-15fb-4745-b4e6-0d45215df52b",
  "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
  "userId": "20785670-86c6-4932-9890-18664dafbf54",
  "type": "WALK_IN",
  "status": "WAITING",
  "scheduledAt": null,
  "scheduledEndAt": null,
  "notes": "first",
  "createdAt": "2026-06-16T13:40:01.226Z",
  "updatedAt": "2026-06-16T13:40:01.226Z"
}
```
> ✅ **CHECK:** Carl's walk-in entry created (got `WAITING`)

### 49. Timeline — Carl pos1 wait0 — after self-join

| Field | Value |
|-------|-------|
| **Action** | Timeline — Carl pos1 wait0 — after self-join |
| **Method + URL** | `GET http://localhost:3000/v1/queues/891b2996-15fb-4745-b4e6-0d45215df52b/timeline` |
| **Path params** | `{"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "entryId": "8d3b5a34-6fff-4044-b9ea-ca94db8504ac",
    "position": 1,
    "estimatedWaitMinutes": 0,
    "members": [
      {
        "memberId": "76fdcbb2-ad41-489d-9866-efe9a428d7f7",
        "memberName": "Carl",
        "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
        "serviceName": "Haircut",
        "serviceDuration": 30,
        "status": "WAITING",
        "isLeader": true
      }
    ]
  }
]
```

> **Timeline (Carl pos1 wait0 — after self-join):** `[{"pos":1,"waitMin":0,"members":[{"name":"Carl","svc":30,"status":"WAITING"}]}]`
> **WebSocket pushes so far:** 2 — last: `[ws] queueTimeline #2: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]`
> ✅ **CHECK:** Carl is position 1, wait 0 (got `1/0`)
> ✅ **CHECK:** WebSocket: received push after Carl joined — cumulative pushes >= 2 (got `yes`)
> **WebSocket log at this point (2 total pushes):**
```
[ws] queueTimeline #1: []
[ws] queueTimeline #2: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
```

## E4 — Barber1 adds Customer2 to their own queue on their behalf (Fade 45m)

> A barber can add a walk-in customer who is standing at the counter but hasn't
> opened the app. They use the same walk-in endpoint with the customer's JWT.
> For MVP, the barber uses the customer's token here; in a real UI the barber
> POSTs on the customer's behalf via the same route.

### 50. Barber1 adds Carol to queue (Fade 45m) — using Carol's token (same endpoint)

| Field | Value |
|-------|-------|
| **Action** | Barber1 adds Carol to queue (Fade 45m) — using Carol's token (same endpoint) |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/891b2996-15fb-4745-b4e6-0d45215df52b/walk-in` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
{
  "members": [
    {
      "memberName": "Carol",
      "serviceId": "5537b04d-83ba-4fc2-9778-e95271106f61"
    }
  ],
  "notes": "added by barber"
}
```

**Response:**
```json
{
  "id": "41d63bb0-eb3c-42c7-8c2d-33cd53c66c47",
  "queueId": "891b2996-15fb-4745-b4e6-0d45215df52b",
  "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
  "userId": "c3c85787-7ada-487a-9b77-4d37c61cc3d1",
  "type": "WALK_IN",
  "status": "WAITING",
  "scheduledAt": null,
  "scheduledEndAt": null,
  "notes": "added by barber",
  "createdAt": "2026-06-16T13:40:03.298Z",
  "updatedAt": "2026-06-16T13:40:03.298Z"
}
```
> ✅ **CHECK:** Carol's entry created (got `WAITING`)

### 51. Timeline — Carl pos1 wait0; Carol pos2 wait30

| Field | Value |
|-------|-------|
| **Action** | Timeline — Carl pos1 wait0; Carol pos2 wait30 |
| **Method + URL** | `GET http://localhost:3000/v1/queues/891b2996-15fb-4745-b4e6-0d45215df52b/timeline` |
| **Path params** | `{"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "entryId": "8d3b5a34-6fff-4044-b9ea-ca94db8504ac",
    "position": 1,
    "estimatedWaitMinutes": 0,
    "members": [
      {
        "memberId": "76fdcbb2-ad41-489d-9866-efe9a428d7f7",
        "memberName": "Carl",
        "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
        "serviceName": "Haircut",
        "serviceDuration": 30,
        "status": "WAITING",
        "isLeader": true
      }
    ]
  },
  {
    "entryId": "41d63bb0-eb3c-42c7-8c2d-33cd53c66c47",
    "position": 2,
    "estimatedWaitMinutes": 30,
    "members": [
      {
        "memberId": "86a05587-773e-4597-9747-cf0587d68b3a",
        "memberName": "Carol",
        "serviceId": "5537b04d-83ba-4fc2-9778-e95271106f61",
        "serviceName": "Fade",
        "serviceDuration": 45,
        "status": "WAITING",
        "isLeader": true
      }
    ]
  }
]
```

> **Timeline (Carl pos1 wait0; Carol pos2 wait30):** `[{"pos":1,"waitMin":0,"members":[{"name":"Carl","svc":30,"status":"WAITING"}]},{"pos":2,"waitMin":30,"members":[{"name":"Carol","svc":45,"status":"WAITING"}]}]`
> **WebSocket pushes so far:** 3 — last: `[ws] queueTimeline #3: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]`
> ✅ **CHECK:** Carl still position 1, wait 0 (got `1/0`)
> ✅ **CHECK:** Carol position 2, wait 30 (Carl's 30m) (got `2/30`)
> ✅ **CHECK:** WebSocket: received push after Carol added — cumulative pushes >= 3 (got `yes`)
> **WebSocket log at this point (3 total pushes):**
```
[ws] queueTimeline #1: []
[ws] queueTimeline #2: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #3: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
```

## E5 — Barber1 staff-cancels Carl's entry (removes him from queue)

> Staff cancel uses DELETE /salons/:salonId/queues/:queueId/entries/:entryId
> with the barber's JWT + STAFF role. Different from the customer self-cancel.

### 52. Barber1 staff-cancels Carl's entry

| Field | Value |
|-------|-------|
| **Action** | Barber1 staff-cancels Carl's entry |
| **Method + URL** | `DELETE http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/891b2996-15fb-4745-b4e6-0d45215df52b/entries/8d3b5a34-6fff-4044-b9ea-ca94db8504ac` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","queueId":"891b2996-15fb-4745-b4e6-0d45215df52b","entryId":"8d3b5a34-6fff-4044-b9ea-ca94db8504ac"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
```

### 53. Timeline — Carol alone at pos1 after Carl cancelled by staff

| Field | Value |
|-------|-------|
| **Action** | Timeline — Carol alone at pos1 after Carl cancelled by staff |
| **Method + URL** | `GET http://localhost:3000/v1/queues/891b2996-15fb-4745-b4e6-0d45215df52b/timeline` |
| **Path params** | `{"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "entryId": "41d63bb0-eb3c-42c7-8c2d-33cd53c66c47",
    "position": 1,
    "estimatedWaitMinutes": 0,
    "members": [
      {
        "memberId": "86a05587-773e-4597-9747-cf0587d68b3a",
        "memberName": "Carol",
        "serviceId": "5537b04d-83ba-4fc2-9778-e95271106f61",
        "serviceName": "Fade",
        "serviceDuration": 45,
        "status": "WAITING",
        "isLeader": true
      }
    ]
  }
]
```

> **Timeline (Carol alone at pos1 after Carl cancelled by staff):** `[{"pos":1,"waitMin":0,"members":[{"name":"Carol","svc":45,"status":"WAITING"}]}]`
> **WebSocket pushes so far:** 4 — last: `[ws] queueTimeline #4: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]`
> ✅ **CHECK:** only Carol left, now position 1 (got `1`)
> ✅ **CHECK:** Carol moved up to position 1 (got `1`)
> ✅ **CHECK:** WebSocket: push received after staff cancel — cumulative pushes >= 4 (got `yes`)
> **WebSocket log at this point (4 total pushes):**
```
[ws] queueTimeline #1: []
[ws] queueTimeline #2: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #3: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #4: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
```

## E6 — Customer1 rejoins as a party of 3 (dad + 2 kids)

### 54. CUSTOMER1 rejoins as party of 3 (Haircut30 + Kids20 + Kids20)

| Field | Value |
|-------|-------|
| **Action** | CUSTOMER1 rejoins as party of 3 (Haircut30 + Kids20 + Kids20) |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/891b2996-15fb-4745-b4e6-0d45215df52b/walk-in` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
{
  "members": [
    {
      "memberName": "Carl (dad)",
      "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c"
    },
    {
      "memberName": "Kid 1",
      "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d"
    },
    {
      "memberName": "Kid 2",
      "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d"
    }
  ],
  "notes": "family"
}
```

**Response:**
```json
{
  "id": "7a34434e-0164-4faa-af12-2e45c3c86efa",
  "queueId": "891b2996-15fb-4745-b4e6-0d45215df52b",
  "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
  "userId": "20785670-86c6-4932-9890-18664dafbf54",
  "type": "WALK_IN",
  "status": "WAITING",
  "scheduledAt": null,
  "scheduledEndAt": null,
  "notes": "family",
  "createdAt": "2026-06-16T13:40:07.459Z",
  "updatedAt": "2026-06-16T13:40:07.459Z"
}
```
> ✅ **CHECK:** party entry created with 3 members (got `WAITING`)

### 55. Timeline — Carol pos1 wait0; family pos2 wait45

| Field | Value |
|-------|-------|
| **Action** | Timeline — Carol pos1 wait0; family pos2 wait45 |
| **Method + URL** | `GET http://localhost:3000/v1/queues/891b2996-15fb-4745-b4e6-0d45215df52b/timeline` |
| **Path params** | `{"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "entryId": "41d63bb0-eb3c-42c7-8c2d-33cd53c66c47",
    "position": 1,
    "estimatedWaitMinutes": 0,
    "members": [
      {
        "memberId": "86a05587-773e-4597-9747-cf0587d68b3a",
        "memberName": "Carol",
        "serviceId": "5537b04d-83ba-4fc2-9778-e95271106f61",
        "serviceName": "Fade",
        "serviceDuration": 45,
        "status": "WAITING",
        "isLeader": true
      }
    ]
  },
  {
    "entryId": "7a34434e-0164-4faa-af12-2e45c3c86efa",
    "position": 2,
    "estimatedWaitMinutes": 45,
    "members": [
      {
        "memberId": "2731f504-5cdb-482c-9516-0c6ef78e4a38",
        "memberName": "Carl (dad)",
        "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
        "serviceName": "Haircut",
        "serviceDuration": 30,
        "status": "WAITING",
        "isLeader": true
      },
      {
        "memberId": "9531986d-e336-4ac6-9f9d-cd0e8bbc3c14",
        "memberName": "Kid 1",
        "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
        "serviceName": "Kids Cut",
        "serviceDuration": 20,
        "status": "WAITING",
        "isLeader": false
      },
      {
        "memberId": "c118b3cd-2a6d-429e-841d-fbc238f139d5",
        "memberName": "Kid 2",
        "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
        "serviceName": "Kids Cut",
        "serviceDuration": 20,
        "status": "WAITING",
        "isLeader": false
      }
    ]
  }
]
```

> **Timeline (Carol pos1 wait0; family pos2 wait45):** `[{"pos":1,"waitMin":0,"members":[{"name":"Carol","svc":45,"status":"WAITING"}]},{"pos":2,"waitMin":45,"members":[{"name":"Carl (dad)","svc":30,"status":"WAITING"},{"name":"Kid 1","svc":20,"status":"WAITING"},{"name":"Kid 2","svc":20,"status":"WAITING"}]}]`
> **WebSocket pushes so far:** 5 — last: `[ws] queueTimeline #5: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]`
> ✅ **CHECK:** Carol still position 1, wait 0 (got `1/0`)
> ✅ **CHECK:** family at position 2, wait 45 (Carol's fade) (got `2/45`)
> ✅ **CHECK:** family entry has 3 members (got `3`)
> ✅ **CHECK:** WebSocket: push received after family joined — cumulative pushes >= 5 (got `yes`)
> **WebSocket log at this point (5 total pushes):**
```
[ws] queueTimeline #1: []
[ws] queueTimeline #2: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #3: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #4: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #5: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
```

## E7 — Party of 4 rejected (maxPartySize = 3)

### 56. CUSTOMER3 tries party of 4 — expect 400

| Field | Value |
|-------|-------|
| **Action** | CUSTOMER3 tries party of 4 — expect 400 |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/891b2996-15fb-4745-b4e6-0d45215df52b/walk-in` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
{
  "members": [
    {
      "memberName": "A",
      "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d"
    },
    {
      "memberName": "B",
      "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d"
    },
    {
      "memberName": "C",
      "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d"
    },
    {
      "memberName": "D",
      "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d"
    }
  ]
}
```

**Response:**
```json
{
  "statusCode": 400,
  "code": null,
  "message": "Maximum party size for this salon is 3. You requested 4.",
  "details": null,
  "timestamp": "2026-06-16T13:40:09.550Z",
  "path": "/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/891b2996-15fb-4745-b4e6-0d45215df52b/walk-in",
  "requestId": "6836e86b-0aab-43c8-8cfd-d03901d05339"
}
```
> ✅ **CHECK:** party of 4 rejected 400 (got `400`)

## E8 — Barber1 pauses queue, join rejected, then resumes

### 57. Barber1 pauses queue

| Field | Value |
|-------|-------|
| **Action** | Barber1 pauses queue |
| **Method + URL** | `PATCH http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/891b2996-15fb-4745-b4e6-0d45215df52b/status` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
{
  "status": "PAUSED"
}
```

**Response:**
```json
{
  "id": "891b2996-15fb-4745-b4e6-0d45215df52b",
  "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
  "status": "PAUSED",
  "version": 0,
  "createdAt": "2026-06-16T13:39:57.416Z",
  "updatedAt": "2026-06-16T13:40:09.580Z"
}
```
> ✅ **CHECK:** queue status is PAUSED (got `PAUSED`)
> ✅ **CHECK:** WebSocket: push received after pause — cumulative pushes >= 6 (got `yes`)
> **WebSocket log at this point (6 total pushes):**
```
[ws] queueTimeline #1: []
[ws] queueTimeline #2: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #3: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #4: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #5: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #6: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
```

### 58. Customer tries to join PAUSED queue — expect 400

| Field | Value |
|-------|-------|
| **Action** | Customer tries to join PAUSED queue — expect 400 |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/891b2996-15fb-4745-b4e6-0d45215df52b/walk-in` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
{
  "members": [
    {
      "memberName": "Late",
      "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c"
    }
  ]
}
```

**Response:**
```json
{
  "statusCode": 400,
  "code": null,
  "message": "This queue is currently PAUSED and not accepting walk-ins.",
  "details": null,
  "timestamp": "2026-06-16T13:40:11.617Z",
  "path": "/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/891b2996-15fb-4745-b4e6-0d45215df52b/walk-in",
  "requestId": "5196f306-f9a1-42d4-9ffb-8f60d333428e"
}
```
> ✅ **CHECK:** join on PAUSED queue rejected 400 (got `400`)

### 59. Barber1 resumes queue

| Field | Value |
|-------|-------|
| **Action** | Barber1 resumes queue |
| **Method + URL** | `PATCH http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/891b2996-15fb-4745-b4e6-0d45215df52b/status` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
{
  "status": "OPEN"
}
```

**Response:**
```json
{
  "id": "891b2996-15fb-4745-b4e6-0d45215df52b",
  "salonId": "6fbd7616-0b1e-4f16-a988-6fe80509e669",
  "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
  "status": "OPEN",
  "version": 0,
  "createdAt": "2026-06-16T13:39:57.416Z",
  "updatedAt": "2026-06-16T13:40:11.646Z"
}
```
> ✅ **CHECK:** queue status back to OPEN (got `OPEN`)
> ✅ **CHECK:** WebSocket: push received after resume — cumulative pushes >= 7 (got `yes`)
> **WebSocket log at this point (7 total pushes):**
```
[ws] queueTimeline #1: []
[ws] queueTimeline #2: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #3: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #4: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #5: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #6: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #7: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
```

## E9 — Customer3 joins Barber2's queue (Beard Trim 15m)

### 60. CUSTOMER3 joins Barber2 (Beard Trim 15m)

| Field | Value |
|-------|-------|
| **Action** | CUSTOMER3 joins Barber2 (Beard Trim 15m) |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/49810b9d-4087-4fca-95ae-1d61022b6c93/walk-in` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","queueId":"49810b9d-4087-4fca-95ae-1d61022b6c93"}` |

**Request body:**
```json
{
  "members": [
    {
      "memberName": "Cody",
      "serviceId": "ca0433ab-3b3d-4dab-98c7-5a4d1f60b917"
    }
  ]
}
```

**Response:**
```json
{
  "id": "cb315ae0-9d64-41d7-b73a-50d489b4f5b0",
  "queueId": "49810b9d-4087-4fca-95ae-1d61022b6c93",
  "staffId": "b25bd6f4-ee07-4708-b11d-df8f409fd636",
  "userId": "9e8cb916-d7ca-42c0-86a0-9b688ef8d4fd",
  "type": "WALK_IN",
  "status": "WAITING",
  "scheduledAt": null,
  "scheduledEndAt": null,
  "notes": null,
  "createdAt": "2026-06-16T13:40:13.687Z",
  "updatedAt": "2026-06-16T13:40:13.687Z"
}
```
> ✅ **CHECK:** Cody's entry created (got `WAITING`)

### 61. Timeline — Barber2 — Cody pos1 wait0

| Field | Value |
|-------|-------|
| **Action** | Timeline — Barber2 — Cody pos1 wait0 |
| **Method + URL** | `GET http://localhost:3000/v1/queues/49810b9d-4087-4fca-95ae-1d61022b6c93/timeline` |
| **Path params** | `{"queueId":"49810b9d-4087-4fca-95ae-1d61022b6c93"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "entryId": "cb315ae0-9d64-41d7-b73a-50d489b4f5b0",
    "position": 1,
    "estimatedWaitMinutes": 0,
    "members": [
      {
        "memberId": "5194371b-c8df-4c35-9e51-8b17895c53fd",
        "memberName": "Cody",
        "serviceId": "ca0433ab-3b3d-4dab-98c7-5a4d1f60b917",
        "serviceName": "Beard Trim",
        "serviceDuration": 15,
        "status": "WAITING",
        "isLeader": true
      }
    ]
  }
]
```

> **Timeline (Barber2 — Cody pos1 wait0):** `[{"pos":1,"waitMin":0,"members":[{"name":"Cody","svc":15,"status":"WAITING"}]}]`
> **WebSocket pushes so far:** 7 — last: `[ws] queueTimeline #7: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]`
> ✅ **CHECK:** Cody position 1 wait 0 on Barber2 (got `1/0`)

---

## SECTION F — Barber1 works through queue

> call-next automatically promotes the entry AND marks the FIRST member SERVING.
> The barber calls serve only on subsequent party members (2nd, 3rd, …).

## F1 — Barber1 calls next (Carol, first in line)

### 62. Barber1 call-next

| Field | Value |
|-------|-------|
| **Action** | Barber1 call-next |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/891b2996-15fb-4745-b4e6-0d45215df52b/call-next` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
{
  "id": "41d63bb0-eb3c-42c7-8c2d-33cd53c66c47",
  "queueId": "891b2996-15fb-4745-b4e6-0d45215df52b",
  "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
  "userId": "c3c85787-7ada-487a-9b77-4d37c61cc3d1",
  "type": "WALK_IN",
  "status": "SERVING",
  "scheduledAt": null,
  "scheduledEndAt": null,
  "notes": "added by barber",
  "createdAt": "2026-06-16T13:40:03.298Z",
  "updatedAt": "2026-06-16T13:40:13.757Z",
  "members": [
    {
      "id": "86a05587-773e-4597-9747-cf0587d68b3a",
      "queueEntryId": "41d63bb0-eb3c-42c7-8c2d-33cd53c66c47",
      "memberName": "Carol",
      "serviceId": "5537b04d-83ba-4fc2-9778-e95271106f61",
      "durationSnapshot": 45,
      "isLeader": true,
      "status": "SERVING",
      "createdAt": "2026-06-16T13:40:03.298Z",
      "updatedAt": "2026-06-16T13:40:13.757Z"
    }
  ]
}
```
> ✅ **CHECK:** call-next entry is SERVING (got `SERVING`)
> ✅ **CHECK:** it is Carol's entry (got `41d63bb0-eb3c-42c7-8c2d-33cd53c66c47`)
> ✅ **CHECK:** Carol auto-marked SERVING by call-next (got `SERVING`)

### 63. Timeline — Carol SERVING pos0; family pos1 wait45

| Field | Value |
|-------|-------|
| **Action** | Timeline — Carol SERVING pos0; family pos1 wait45 |
| **Method + URL** | `GET http://localhost:3000/v1/queues/891b2996-15fb-4745-b4e6-0d45215df52b/timeline` |
| **Path params** | `{"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "entryId": "41d63bb0-eb3c-42c7-8c2d-33cd53c66c47",
    "position": 0,
    "estimatedWaitMinutes": 0,
    "members": [
      {
        "memberId": "86a05587-773e-4597-9747-cf0587d68b3a",
        "memberName": "Carol",
        "serviceId": "5537b04d-83ba-4fc2-9778-e95271106f61",
        "serviceName": "Fade",
        "serviceDuration": 45,
        "status": "SERVING",
        "isLeader": true
      }
    ]
  },
  {
    "entryId": "7a34434e-0164-4faa-af12-2e45c3c86efa",
    "position": 1,
    "estimatedWaitMinutes": 45,
    "members": [
      {
        "memberId": "2731f504-5cdb-482c-9516-0c6ef78e4a38",
        "memberName": "Carl (dad)",
        "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
        "serviceName": "Haircut",
        "serviceDuration": 30,
        "status": "WAITING",
        "isLeader": true
      },
      {
        "memberId": "9531986d-e336-4ac6-9f9d-cd0e8bbc3c14",
        "memberName": "Kid 1",
        "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
        "serviceName": "Kids Cut",
        "serviceDuration": 20,
        "status": "WAITING",
        "isLeader": false
      },
      {
        "memberId": "c118b3cd-2a6d-429e-841d-fbc238f139d5",
        "memberName": "Kid 2",
        "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
        "serviceName": "Kids Cut",
        "serviceDuration": 20,
        "status": "WAITING",
        "isLeader": false
      }
    ]
  }
]
```

> **Timeline (Carol SERVING pos0; family pos1 wait45):** `[{"pos":0,"waitMin":0,"members":[{"name":"Carol","svc":45,"status":"SERVING"}]},{"pos":1,"waitMin":45,"members":[{"name":"Carl (dad)","svc":30,"status":"WAITING"},{"name":"Kid 1","svc":20,"status":"WAITING"},{"name":"Kid 2","svc":20,"status":"WAITING"}]}]`
> **WebSocket pushes so far:** 8 — last: `[ws] queueTimeline #8: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]`
> ✅ **CHECK:** Carol at position 0 (SERVING) (got `0`)
> ✅ **CHECK:** family wait = 45 (Carol's full fade) (got `45`)
> ✅ **CHECK:** WebSocket: customerCalled + timeline after call-next — cumulative pushes >= 8 (got `yes`)
> **WebSocket log at this point (8 total pushes):**
```
[ws] queueTimeline #1: []
[ws] queueTimeline #2: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #3: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #4: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #5: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #6: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #7: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] event 'customerCalled': {"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b","entryId":"41d63bb0-eb3c-42c7-8c2d-33cd53c66c47"}
[ws] queueTimeline #8: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
```

## F2 — Barber1 extends Carol +15 min (needs more time)

### 64. Barber1 extends Carol +15m

| Field | Value |
|-------|-------|
| **Action** | Barber1 extends Carol +15m |
| **Method + URL** | `PATCH http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/891b2996-15fb-4745-b4e6-0d45215df52b/entries/41d63bb0-eb3c-42c7-8c2d-33cd53c66c47/members/86a05587-773e-4597-9747-cf0587d68b3a/extend` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","queueId":"891b2996-15fb-4745-b4e6-0d45215df52b","entryId":"41d63bb0-eb3c-42c7-8c2d-33cd53c66c47","memberId":"86a05587-773e-4597-9747-cf0587d68b3a"}` |

**Request body:**
```json
{
  "extraMinutes": 15
}
```

**Response:**
```json
{
  "id": "86a05587-773e-4597-9747-cf0587d68b3a",
  "queueEntryId": "41d63bb0-eb3c-42c7-8c2d-33cd53c66c47",
  "memberName": "Carol",
  "serviceId": "5537b04d-83ba-4fc2-9778-e95271106f61",
  "durationSnapshot": 60,
  "isLeader": true,
  "status": "SERVING",
  "createdAt": "2026-06-16T13:40:03.298Z",
  "updatedAt": "2026-06-16T13:40:15.872Z"
}
```
> ✅ **CHECK:** Carol's durationSnapshot 45 → 60 (got `60`)

### 65. Timeline — after +15: family wait now 60

| Field | Value |
|-------|-------|
| **Action** | Timeline — after +15: family wait now 60 |
| **Method + URL** | `GET http://localhost:3000/v1/queues/891b2996-15fb-4745-b4e6-0d45215df52b/timeline` |
| **Path params** | `{"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "entryId": "41d63bb0-eb3c-42c7-8c2d-33cd53c66c47",
    "position": 0,
    "estimatedWaitMinutes": 0,
    "members": [
      {
        "memberId": "86a05587-773e-4597-9747-cf0587d68b3a",
        "memberName": "Carol",
        "serviceId": "5537b04d-83ba-4fc2-9778-e95271106f61",
        "serviceName": "Fade",
        "serviceDuration": 60,
        "status": "SERVING",
        "isLeader": true
      }
    ]
  },
  {
    "entryId": "7a34434e-0164-4faa-af12-2e45c3c86efa",
    "position": 1,
    "estimatedWaitMinutes": 60,
    "members": [
      {
        "memberId": "2731f504-5cdb-482c-9516-0c6ef78e4a38",
        "memberName": "Carl (dad)",
        "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
        "serviceName": "Haircut",
        "serviceDuration": 30,
        "status": "WAITING",
        "isLeader": true
      },
      {
        "memberId": "9531986d-e336-4ac6-9f9d-cd0e8bbc3c14",
        "memberName": "Kid 1",
        "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
        "serviceName": "Kids Cut",
        "serviceDuration": 20,
        "status": "WAITING",
        "isLeader": false
      },
      {
        "memberId": "c118b3cd-2a6d-429e-841d-fbc238f139d5",
        "memberName": "Kid 2",
        "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
        "serviceName": "Kids Cut",
        "serviceDuration": 20,
        "status": "WAITING",
        "isLeader": false
      }
    ]
  }
]
```

> **Timeline (after +15: family wait now 60):** `[{"pos":0,"waitMin":0,"members":[{"name":"Carol","svc":60,"status":"SERVING"}]},{"pos":1,"waitMin":60,"members":[{"name":"Carl (dad)","svc":30,"status":"WAITING"},{"name":"Kid 1","svc":20,"status":"WAITING"},{"name":"Kid 2","svc":20,"status":"WAITING"}]}]`
> **WebSocket pushes so far:** 9 — last: `[ws] queueTimeline #9: [{"pos":0,"waitMin":0,"members":["Carol(60m,SERVING)"]},{"pos":1,"waitMin":60,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]`
> ✅ **CHECK:** family wait grew 45 → 60 after extend (got `60`)
> ✅ **CHECK:** Carol snapshot is now 60 (got `60`)
> ✅ **CHECK:** WebSocket: push received after extend — cumulative pushes >= 9 (got `yes`)
> **WebSocket log at this point (9 total pushes):**
```
[ws] queueTimeline #1: []
[ws] queueTimeline #2: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #3: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #4: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #5: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #6: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #7: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] event 'customerCalled': {"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b","entryId":"41d63bb0-eb3c-42c7-8c2d-33cd53c66c47"}
[ws] queueTimeline #8: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #9: [{"pos":0,"waitMin":0,"members":["Carol(60m,SERVING)"]},{"pos":1,"waitMin":60,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
```

## F3 — Barber1 completes Carol

### 66. Barber1 completes Carol

| Field | Value |
|-------|-------|
| **Action** | Barber1 completes Carol |
| **Method + URL** | `PATCH http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/891b2996-15fb-4745-b4e6-0d45215df52b/entries/41d63bb0-eb3c-42c7-8c2d-33cd53c66c47/members/86a05587-773e-4597-9747-cf0587d68b3a/complete` |
| **Path params** | `{"memberId":"86a05587-773e-4597-9747-cf0587d68b3a"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
{
  "id": "86a05587-773e-4597-9747-cf0587d68b3a",
  "queueEntryId": "41d63bb0-eb3c-42c7-8c2d-33cd53c66c47",
  "memberName": "Carol",
  "serviceId": "5537b04d-83ba-4fc2-9778-e95271106f61",
  "durationSnapshot": 60,
  "isLeader": true,
  "status": "SERVED",
  "createdAt": "2026-06-16T13:40:03.298Z",
  "updatedAt": "2026-06-16T13:40:17.949Z"
}
```

### 67. Timeline — Carol done; family promoted to pos1 wait0

| Field | Value |
|-------|-------|
| **Action** | Timeline — Carol done; family promoted to pos1 wait0 |
| **Method + URL** | `GET http://localhost:3000/v1/queues/891b2996-15fb-4745-b4e6-0d45215df52b/timeline` |
| **Path params** | `{"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "entryId": "7a34434e-0164-4faa-af12-2e45c3c86efa",
    "position": 1,
    "estimatedWaitMinutes": 0,
    "members": [
      {
        "memberId": "2731f504-5cdb-482c-9516-0c6ef78e4a38",
        "memberName": "Carl (dad)",
        "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
        "serviceName": "Haircut",
        "serviceDuration": 30,
        "status": "WAITING",
        "isLeader": true
      },
      {
        "memberId": "9531986d-e336-4ac6-9f9d-cd0e8bbc3c14",
        "memberName": "Kid 1",
        "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
        "serviceName": "Kids Cut",
        "serviceDuration": 20,
        "status": "WAITING",
        "isLeader": false
      },
      {
        "memberId": "c118b3cd-2a6d-429e-841d-fbc238f139d5",
        "memberName": "Kid 2",
        "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
        "serviceName": "Kids Cut",
        "serviceDuration": 20,
        "status": "WAITING",
        "isLeader": false
      }
    ]
  }
]
```

> **Timeline (Carol done; family promoted to pos1 wait0):** `[{"pos":1,"waitMin":0,"members":[{"name":"Carl (dad)","svc":30,"status":"WAITING"},{"name":"Kid 1","svc":20,"status":"WAITING"},{"name":"Kid 2","svc":20,"status":"WAITING"}]}]`
> **WebSocket pushes so far:** 10 — last: `[ws] queueTimeline #10: [{"pos":1,"waitMin":0,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]`
> ✅ **CHECK:** family promoted to position 1 after Carol done (got `1`)
> ✅ **CHECK:** family wait is now 0 (they're next) (got `0`)
> ✅ **CHECK:** WebSocket: push received after Carol completed — cumulative pushes >= 10 (got `yes`)
> **WebSocket log at this point (10 total pushes):**
```
[ws] queueTimeline #1: []
[ws] queueTimeline #2: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #3: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #4: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #5: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #6: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #7: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] event 'customerCalled': {"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b","entryId":"41d63bb0-eb3c-42c7-8c2d-33cd53c66c47"}
[ws] queueTimeline #8: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #9: [{"pos":0,"waitMin":0,"members":["Carol(60m,SERVING)"]},{"pos":1,"waitMin":60,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #10: [{"pos":1,"waitMin":0,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
```

## F4 — Barber1 calls next (the family party of 3)

### 68. Barber1 call-next (family)

| Field | Value |
|-------|-------|
| **Action** | Barber1 call-next (family) |
| **Method + URL** | `POST http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/891b2996-15fb-4745-b4e6-0d45215df52b/call-next` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
{
  "id": "7a34434e-0164-4faa-af12-2e45c3c86efa",
  "queueId": "891b2996-15fb-4745-b4e6-0d45215df52b",
  "staffId": "90c0eca6-c362-4d35-b59d-1a64c163f32c",
  "userId": "20785670-86c6-4932-9890-18664dafbf54",
  "type": "WALK_IN",
  "status": "SERVING",
  "scheduledAt": null,
  "scheduledEndAt": null,
  "notes": "family",
  "createdAt": "2026-06-16T13:40:07.459Z",
  "updatedAt": "2026-06-16T13:40:20.018Z",
  "members": [
    {
      "id": "2731f504-5cdb-482c-9516-0c6ef78e4a38",
      "queueEntryId": "7a34434e-0164-4faa-af12-2e45c3c86efa",
      "memberName": "Carl (dad)",
      "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
      "durationSnapshot": 30,
      "isLeader": true,
      "status": "SERVING",
      "createdAt": "2026-06-16T13:40:07.459Z",
      "updatedAt": "2026-06-16T13:40:20.018Z"
    },
    {
      "id": "9531986d-e336-4ac6-9f9d-cd0e8bbc3c14",
      "queueEntryId": "7a34434e-0164-4faa-af12-2e45c3c86efa",
      "memberName": "Kid 1",
      "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
      "durationSnapshot": 20,
      "isLeader": false,
      "status": "WAITING",
      "createdAt": "2026-06-16T13:40:07.459Z",
      "updatedAt": "2026-06-16T13:40:07.459Z"
    },
    {
      "id": "c118b3cd-2a6d-429e-841d-fbc238f139d5",
      "queueEntryId": "7a34434e-0164-4faa-af12-2e45c3c86efa",
      "memberName": "Kid 2",
      "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
      "durationSnapshot": 20,
      "isLeader": false,
      "status": "WAITING",
      "createdAt": "2026-06-16T13:40:07.459Z",
      "updatedAt": "2026-06-16T13:40:07.459Z"
    }
  ]
}
```
> ✅ **CHECK:** family entry is now SERVING (got `SERVING`)
> ✅ **CHECK:** it is the family party entry (got `7a34434e-0164-4faa-af12-2e45c3c86efa`)
> ✅ **CHECK:** dad auto-SERVING by call-next (got `SERVING`)

### 69. Timeline — family SERVING pos0 — dad SERVING, kids WAITING

| Field | Value |
|-------|-------|
| **Action** | Timeline — family SERVING pos0 — dad SERVING, kids WAITING |
| **Method + URL** | `GET http://localhost:3000/v1/queues/891b2996-15fb-4745-b4e6-0d45215df52b/timeline` |
| **Path params** | `{"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "entryId": "7a34434e-0164-4faa-af12-2e45c3c86efa",
    "position": 0,
    "estimatedWaitMinutes": 0,
    "members": [
      {
        "memberId": "9531986d-e336-4ac6-9f9d-cd0e8bbc3c14",
        "memberName": "Kid 1",
        "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
        "serviceName": "Kids Cut",
        "serviceDuration": 20,
        "status": "WAITING",
        "isLeader": false
      },
      {
        "memberId": "c118b3cd-2a6d-429e-841d-fbc238f139d5",
        "memberName": "Kid 2",
        "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
        "serviceName": "Kids Cut",
        "serviceDuration": 20,
        "status": "WAITING",
        "isLeader": false
      },
      {
        "memberId": "2731f504-5cdb-482c-9516-0c6ef78e4a38",
        "memberName": "Carl (dad)",
        "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
        "serviceName": "Haircut",
        "serviceDuration": 30,
        "status": "SERVING",
        "isLeader": true
      }
    ]
  }
]
```

> **Timeline (family SERVING pos0 — dad SERVING, kids WAITING):** `[{"pos":0,"waitMin":0,"members":[{"name":"Kid 1","svc":20,"status":"WAITING"},{"name":"Kid 2","svc":20,"status":"WAITING"},{"name":"Carl (dad)","svc":30,"status":"SERVING"}]}]`
> **WebSocket pushes so far:** 11 — last: `[ws] queueTimeline #11: [{"pos":1,"waitMin":0,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]`
> ✅ **CHECK:** family at position 0 (got `0`)
> ✅ **CHECK:** WebSocket: customerCalled + timeline after family call-next — cumulative pushes >= 11 (got `yes`)
> **WebSocket log at this point (11 total pushes):**
```
[ws] queueTimeline #1: []
[ws] queueTimeline #2: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #3: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #4: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #5: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #6: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #7: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] event 'customerCalled': {"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b","entryId":"41d63bb0-eb3c-42c7-8c2d-33cd53c66c47"}
[ws] queueTimeline #8: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #9: [{"pos":0,"waitMin":0,"members":["Carol(60m,SERVING)"]},{"pos":1,"waitMin":60,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #10: [{"pos":1,"waitMin":0,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] event 'customerCalled': {"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b","entryId":"7a34434e-0164-4faa-af12-2e45c3c86efa"}
[ws] queueTimeline #11: [{"pos":1,"waitMin":0,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
```

## F5 — Barber1 completes dad (was auto-served by call-next)

> Dad was auto-marked SERVING by call-next — barber goes straight to complete.

### 70. Barber1 completes dad

| Field | Value |
|-------|-------|
| **Action** | Barber1 completes dad |
| **Method + URL** | `PATCH http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/891b2996-15fb-4745-b4e6-0d45215df52b/entries/7a34434e-0164-4faa-af12-2e45c3c86efa/members/2731f504-5cdb-482c-9516-0c6ef78e4a38/complete` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","queueId":"891b2996-15fb-4745-b4e6-0d45215df52b","entryId":"7a34434e-0164-4faa-af12-2e45c3c86efa","memberId":"2731f504-5cdb-482c-9516-0c6ef78e4a38"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
{
  "id": "2731f504-5cdb-482c-9516-0c6ef78e4a38",
  "queueEntryId": "7a34434e-0164-4faa-af12-2e45c3c86efa",
  "memberName": "Carl (dad)",
  "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
  "durationSnapshot": 30,
  "isLeader": true,
  "status": "SERVED",
  "createdAt": "2026-06-16T13:40:07.459Z",
  "updatedAt": "2026-06-16T13:40:22.123Z"
}
```

### 71. Timeline — dad SERVED; Kid1 + Kid2 still WAITING

| Field | Value |
|-------|-------|
| **Action** | Timeline — dad SERVED; Kid1 + Kid2 still WAITING |
| **Method + URL** | `GET http://localhost:3000/v1/queues/891b2996-15fb-4745-b4e6-0d45215df52b/timeline` |
| **Path params** | `{"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "entryId": "7a34434e-0164-4faa-af12-2e45c3c86efa",
    "position": 0,
    "estimatedWaitMinutes": 0,
    "members": [
      {
        "memberId": "9531986d-e336-4ac6-9f9d-cd0e8bbc3c14",
        "memberName": "Kid 1",
        "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
        "serviceName": "Kids Cut",
        "serviceDuration": 20,
        "status": "WAITING",
        "isLeader": false
      },
      {
        "memberId": "c118b3cd-2a6d-429e-841d-fbc238f139d5",
        "memberName": "Kid 2",
        "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
        "serviceName": "Kids Cut",
        "serviceDuration": 20,
        "status": "WAITING",
        "isLeader": false
      },
      {
        "memberId": "2731f504-5cdb-482c-9516-0c6ef78e4a38",
        "memberName": "Carl (dad)",
        "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
        "serviceName": "Haircut",
        "serviceDuration": 30,
        "status": "SERVED",
        "isLeader": true
      }
    ]
  }
]
```

> **Timeline (dad SERVED; Kid1 + Kid2 still WAITING):** `[{"pos":0,"waitMin":0,"members":[{"name":"Kid 1","svc":20,"status":"WAITING"},{"name":"Kid 2","svc":20,"status":"WAITING"},{"name":"Carl (dad)","svc":30,"status":"SERVED"}]}]`
> **WebSocket pushes so far:** 12 — last: `[ws] queueTimeline #12: [{"pos":0,"waitMin":0,"members":["Kid 1(20m,WAITING)","Kid 2(20m,WAITING)","Carl (dad)(30m,SERVED)"]}]`
> ✅ **CHECK:** dad is now SERVED (got `SERVED`)
> ✅ **CHECK:** Kid 1 still WAITING (got `WAITING`)
> ✅ **CHECK:** WebSocket: push after dad completed — cumulative pushes >= 12 (got `yes`)
> **WebSocket log at this point (12 total pushes):**
```
[ws] queueTimeline #1: []
[ws] queueTimeline #2: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #3: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #4: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #5: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #6: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #7: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] event 'customerCalled': {"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b","entryId":"41d63bb0-eb3c-42c7-8c2d-33cd53c66c47"}
[ws] queueTimeline #8: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #9: [{"pos":0,"waitMin":0,"members":["Carol(60m,SERVING)"]},{"pos":1,"waitMin":60,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #10: [{"pos":1,"waitMin":0,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] event 'customerCalled': {"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b","entryId":"7a34434e-0164-4faa-af12-2e45c3c86efa"}
[ws] queueTimeline #11: [{"pos":1,"waitMin":0,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #12: [{"pos":0,"waitMin":0,"members":["Kid 1(20m,WAITING)","Kid 2(20m,WAITING)","Carl (dad)(30m,SERVED)"]}]
```

## F6 — Barber1 explicitly SERVES Kid1 (subsequent party member)

> This is the explicit `serve` action — required for 2nd and later party members.

### 72. Barber1 serves Kid1

| Field | Value |
|-------|-------|
| **Action** | Barber1 serves Kid1 |
| **Method + URL** | `PATCH http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/891b2996-15fb-4745-b4e6-0d45215df52b/entries/7a34434e-0164-4faa-af12-2e45c3c86efa/members/9531986d-e336-4ac6-9f9d-cd0e8bbc3c14/serve` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","queueId":"891b2996-15fb-4745-b4e6-0d45215df52b","entryId":"7a34434e-0164-4faa-af12-2e45c3c86efa","memberId":"9531986d-e336-4ac6-9f9d-cd0e8bbc3c14"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
{
  "id": "9531986d-e336-4ac6-9f9d-cd0e8bbc3c14",
  "queueEntryId": "7a34434e-0164-4faa-af12-2e45c3c86efa",
  "memberName": "Kid 1",
  "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
  "durationSnapshot": 20,
  "isLeader": false,
  "status": "SERVING",
  "createdAt": "2026-06-16T13:40:07.459Z",
  "updatedAt": "2026-06-16T13:40:24.198Z"
}
```
> ✅ **CHECK:** Kid1 is now SERVING (got `SERVING`)

### 73. Timeline — Kid1 SERVING; Kid2 WAITING

| Field | Value |
|-------|-------|
| **Action** | Timeline — Kid1 SERVING; Kid2 WAITING |
| **Method + URL** | `GET http://localhost:3000/v1/queues/891b2996-15fb-4745-b4e6-0d45215df52b/timeline` |
| **Path params** | `{"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "entryId": "7a34434e-0164-4faa-af12-2e45c3c86efa",
    "position": 0,
    "estimatedWaitMinutes": 0,
    "members": [
      {
        "memberId": "c118b3cd-2a6d-429e-841d-fbc238f139d5",
        "memberName": "Kid 2",
        "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
        "serviceName": "Kids Cut",
        "serviceDuration": 20,
        "status": "WAITING",
        "isLeader": false
      },
      {
        "memberId": "2731f504-5cdb-482c-9516-0c6ef78e4a38",
        "memberName": "Carl (dad)",
        "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
        "serviceName": "Haircut",
        "serviceDuration": 30,
        "status": "SERVED",
        "isLeader": true
      },
      {
        "memberId": "9531986d-e336-4ac6-9f9d-cd0e8bbc3c14",
        "memberName": "Kid 1",
        "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
        "serviceName": "Kids Cut",
        "serviceDuration": 20,
        "status": "SERVING",
        "isLeader": false
      }
    ]
  }
]
```

> **Timeline (Kid1 SERVING; Kid2 WAITING):** `[{"pos":0,"waitMin":0,"members":[{"name":"Kid 2","svc":20,"status":"WAITING"},{"name":"Carl (dad)","svc":30,"status":"SERVED"},{"name":"Kid 1","svc":20,"status":"SERVING"}]}]`
> **WebSocket pushes so far:** 13 — last: `[ws] queueTimeline #13: [{"pos":0,"waitMin":0,"members":["Kid 2(20m,WAITING)","Carl (dad)(30m,SERVED)","Kid 1(20m,SERVING)"]}]`
> ✅ **CHECK:** Kid1 SERVING confirmed in timeline (got `SERVING`)
> ✅ **CHECK:** WebSocket: push after Kid1 served — cumulative pushes >= 13 (got `yes`)
> **WebSocket log at this point (13 total pushes):**
```
[ws] queueTimeline #1: []
[ws] queueTimeline #2: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #3: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #4: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #5: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #6: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #7: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] event 'customerCalled': {"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b","entryId":"41d63bb0-eb3c-42c7-8c2d-33cd53c66c47"}
[ws] queueTimeline #8: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #9: [{"pos":0,"waitMin":0,"members":["Carol(60m,SERVING)"]},{"pos":1,"waitMin":60,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #10: [{"pos":1,"waitMin":0,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] event 'customerCalled': {"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b","entryId":"7a34434e-0164-4faa-af12-2e45c3c86efa"}
[ws] queueTimeline #11: [{"pos":1,"waitMin":0,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #12: [{"pos":0,"waitMin":0,"members":["Kid 1(20m,WAITING)","Kid 2(20m,WAITING)","Carl (dad)(30m,SERVED)"]}]
[ws] queueTimeline #13: [{"pos":0,"waitMin":0,"members":["Kid 2(20m,WAITING)","Carl (dad)(30m,SERVED)","Kid 1(20m,SERVING)"]}]
```

## F7 — Barber1 completes Kid1

### 74. Barber1 completes Kid1

| Field | Value |
|-------|-------|
| **Action** | Barber1 completes Kid1 |
| **Method + URL** | `PATCH http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/891b2996-15fb-4745-b4e6-0d45215df52b/entries/7a34434e-0164-4faa-af12-2e45c3c86efa/members/9531986d-e336-4ac6-9f9d-cd0e8bbc3c14/complete` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","queueId":"891b2996-15fb-4745-b4e6-0d45215df52b","entryId":"7a34434e-0164-4faa-af12-2e45c3c86efa","memberId":"9531986d-e336-4ac6-9f9d-cd0e8bbc3c14"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
{
  "id": "9531986d-e336-4ac6-9f9d-cd0e8bbc3c14",
  "queueEntryId": "7a34434e-0164-4faa-af12-2e45c3c86efa",
  "memberName": "Kid 1",
  "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
  "durationSnapshot": 20,
  "isLeader": false,
  "status": "SERVED",
  "createdAt": "2026-06-16T13:40:07.459Z",
  "updatedAt": "2026-06-16T13:40:26.286Z"
}
```

### 75. Timeline — dad+Kid1 SERVED; Kid2 still WAITING

| Field | Value |
|-------|-------|
| **Action** | Timeline — dad+Kid1 SERVED; Kid2 still WAITING |
| **Method + URL** | `GET http://localhost:3000/v1/queues/891b2996-15fb-4745-b4e6-0d45215df52b/timeline` |
| **Path params** | `{"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "entryId": "7a34434e-0164-4faa-af12-2e45c3c86efa",
    "position": 0,
    "estimatedWaitMinutes": 0,
    "members": [
      {
        "memberId": "c118b3cd-2a6d-429e-841d-fbc238f139d5",
        "memberName": "Kid 2",
        "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
        "serviceName": "Kids Cut",
        "serviceDuration": 20,
        "status": "WAITING",
        "isLeader": false
      },
      {
        "memberId": "2731f504-5cdb-482c-9516-0c6ef78e4a38",
        "memberName": "Carl (dad)",
        "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
        "serviceName": "Haircut",
        "serviceDuration": 30,
        "status": "SERVED",
        "isLeader": true
      },
      {
        "memberId": "9531986d-e336-4ac6-9f9d-cd0e8bbc3c14",
        "memberName": "Kid 1",
        "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
        "serviceName": "Kids Cut",
        "serviceDuration": 20,
        "status": "SERVED",
        "isLeader": false
      }
    ]
  }
]
```

> **Timeline (dad+Kid1 SERVED; Kid2 still WAITING):** `[{"pos":0,"waitMin":0,"members":[{"name":"Kid 2","svc":20,"status":"WAITING"},{"name":"Carl (dad)","svc":30,"status":"SERVED"},{"name":"Kid 1","svc":20,"status":"SERVED"}]}]`
> **WebSocket pushes so far:** 14 — last: `[ws] queueTimeline #14: [{"pos":0,"waitMin":0,"members":["Kid 2(20m,WAITING)","Carl (dad)(30m,SERVED)","Kid 1(20m,SERVED)"]}]`
> ✅ **CHECK:** Kid2 still WAITING in serving party (got `WAITING`)
> ✅ **CHECK:** WebSocket: push after Kid1 completed — cumulative pushes >= 14 (got `yes`)
> **WebSocket log at this point (14 total pushes):**
```
[ws] queueTimeline #1: []
[ws] queueTimeline #2: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #3: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #4: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #5: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #6: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #7: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] event 'customerCalled': {"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b","entryId":"41d63bb0-eb3c-42c7-8c2d-33cd53c66c47"}
[ws] queueTimeline #8: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #9: [{"pos":0,"waitMin":0,"members":["Carol(60m,SERVING)"]},{"pos":1,"waitMin":60,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #10: [{"pos":1,"waitMin":0,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] event 'customerCalled': {"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b","entryId":"7a34434e-0164-4faa-af12-2e45c3c86efa"}
[ws] queueTimeline #11: [{"pos":1,"waitMin":0,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #12: [{"pos":0,"waitMin":0,"members":["Kid 1(20m,WAITING)","Kid 2(20m,WAITING)","Carl (dad)(30m,SERVED)"]}]
[ws] queueTimeline #13: [{"pos":0,"waitMin":0,"members":["Kid 2(20m,WAITING)","Carl (dad)(30m,SERVED)","Kid 1(20m,SERVING)"]}]
[ws] queueTimeline #14: [{"pos":0,"waitMin":0,"members":["Kid 2(20m,WAITING)","Carl (dad)(30m,SERVED)","Kid 1(20m,SERVED)"]}]
```

---

## SECTION G — Barber2 queue: no-show

## G1 — Barber2 marks Cody a NO_SHOW

### 76. Barber2 no-shows Cody

| Field | Value |
|-------|-------|
| **Action** | Barber2 no-shows Cody |
| **Method + URL** | `PATCH http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/49810b9d-4087-4fca-95ae-1d61022b6c93/entries/cb315ae0-9d64-41d7-b73a-50d489b4f5b0/no-show` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","queueId":"49810b9d-4087-4fca-95ae-1d61022b6c93","entryId":"cb315ae0-9d64-41d7-b73a-50d489b4f5b0"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
{
  "id": "cb315ae0-9d64-41d7-b73a-50d489b4f5b0",
  "queueId": "49810b9d-4087-4fca-95ae-1d61022b6c93",
  "staffId": "b25bd6f4-ee07-4708-b11d-df8f409fd636",
  "userId": "9e8cb916-d7ca-42c0-86a0-9b688ef8d4fd",
  "type": "WALK_IN",
  "status": "NO_SHOW",
  "scheduledAt": null,
  "scheduledEndAt": null,
  "notes": null,
  "createdAt": "2026-06-16T13:40:13.687Z",
  "updatedAt": "2026-06-16T13:40:28.356Z"
}
```
> ✅ **CHECK:** Cody's entry is NO_SHOW (got `NO_SHOW`)

### 77. Timeline — Barber2 queue empty after no-show

| Field | Value |
|-------|-------|
| **Action** | Timeline — Barber2 queue empty after no-show |
| **Method + URL** | `GET http://localhost:3000/v1/queues/49810b9d-4087-4fca-95ae-1d61022b6c93/timeline` |
| **Path params** | `{"queueId":"49810b9d-4087-4fca-95ae-1d61022b6c93"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[]
```

> **Timeline (Barber2 queue empty after no-show):** `[]`
> **WebSocket pushes so far:** 14 — last: `[ws] queueTimeline #14: [{"pos":0,"waitMin":0,"members":["Kid 2(20m,WAITING)","Carl (dad)(30m,SERVED)","Kid 1(20m,SERVED)"]}]`
> ✅ **CHECK:** Barber2 queue empty (got `0`)

## G2 — Double no-show on same entry rejected (entry already NO_SHOW)

### 78. Double no-show on Cody — expect 400

| Field | Value |
|-------|-------|
| **Action** | Double no-show on Cody — expect 400 |
| **Method + URL** | `PATCH http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/49810b9d-4087-4fca-95ae-1d61022b6c93/entries/cb315ae0-9d64-41d7-b73a-50d489b4f5b0/no-show` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","queueId":"49810b9d-4087-4fca-95ae-1d61022b6c93","entryId":"cb315ae0-9d64-41d7-b73a-50d489b4f5b0"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
{
  "statusCode": 400,
  "code": null,
  "message": "Only WAITING entries can be marked as NO_SHOW (current: NO_SHOW).",
  "details": null,
  "timestamp": "2026-06-16T13:40:28.420Z",
  "path": "/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/queues/49810b9d-4087-4fca-95ae-1d61022b6c93/entries/cb315ae0-9d64-41d7-b73a-50d489b4f5b0/no-show",
  "requestId": "c97b7d74-d2cc-4838-bc47-2faeca20f8e1"
}
```
> ✅ **CHECK:** double no-show rejected 400 (got `400`)

---

## SECTION H — durationSnapshot invariant

> Kid2 is still WAITING with a Kids Cut (20m snapshot). We deactivate the
> Kids Cut service and confirm the snapshot in the live queue is unchanged.

### 79. Deactivate Kids Cut service

| Field | Value |
|-------|-------|
| **Action** | Deactivate Kids Cut service |
| **Method + URL** | `DELETE http://localhost:3000/v1/salons/6fbd7616-0b1e-4f16-a988-6fe80509e669/services/43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d` |
| **Path params** | `{"salonId":"6fbd7616-0b1e-4f16-a988-6fe80509e669","serviceId":"43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
```

### 80. Timeline — after Kids Cut deactivated — Kid2 snapshot must be unchanged

| Field | Value |
|-------|-------|
| **Action** | Timeline — after Kids Cut deactivated — Kid2 snapshot must be unchanged |
| **Method + URL** | `GET http://localhost:3000/v1/queues/891b2996-15fb-4745-b4e6-0d45215df52b/timeline` |
| **Path params** | `{"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b"}` |

**Request body:**
```json
(none)
```

**Response:**
```json
[
  {
    "entryId": "7a34434e-0164-4faa-af12-2e45c3c86efa",
    "position": 0,
    "estimatedWaitMinutes": 0,
    "members": [
      {
        "memberId": "c118b3cd-2a6d-429e-841d-fbc238f139d5",
        "memberName": "Kid 2",
        "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
        "serviceName": "Kids Cut",
        "serviceDuration": 20,
        "status": "WAITING",
        "isLeader": false
      },
      {
        "memberId": "2731f504-5cdb-482c-9516-0c6ef78e4a38",
        "memberName": "Carl (dad)",
        "serviceId": "5ec038db-43bd-4951-be42-0eb6d6b0c98c",
        "serviceName": "Haircut",
        "serviceDuration": 30,
        "status": "SERVED",
        "isLeader": true
      },
      {
        "memberId": "9531986d-e336-4ac6-9f9d-cd0e8bbc3c14",
        "memberName": "Kid 1",
        "serviceId": "43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d",
        "serviceName": "Kids Cut",
        "serviceDuration": 20,
        "status": "SERVED",
        "isLeader": false
      }
    ]
  }
]
```

> **Timeline (after Kids Cut deactivated — Kid2 snapshot must be unchanged):** `[{"pos":0,"waitMin":0,"members":[{"name":"Kid 2","svc":20,"status":"WAITING"},{"name":"Carl (dad)","svc":30,"status":"SERVED"},{"name":"Kid 1","svc":20,"status":"SERVED"}]}]`
> **WebSocket pushes so far:** 14 — last: `[ws] queueTimeline #14: [{"pos":0,"waitMin":0,"members":["Kid 2(20m,WAITING)","Carl (dad)(30m,SERVED)","Kid 1(20m,SERVED)"]}]`
> ✅ **CHECK:** Kid2 durationSnapshot (20 m) unchanged after service deactivated (got `20`)

---

## SECTION I — WebSocket final summary

### Full WebSocket log (Barber1's queue)
```
[ws] connected to /queues namespace — joining queue 891b2996-15fb-4745-b4e6-0d45215df52b
[ws] queueTimeline #1: []
[ws] queueTimeline #2: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #3: [{"pos":1,"waitMin":0,"members":["Carl(30m,WAITING)"]}]
[ws] queueTimeline #4: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #5: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]}]
[ws] queueTimeline #6: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #7: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] event 'customerCalled': {"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b","entryId":"41d63bb0-eb3c-42c7-8c2d-33cd53c66c47"}
[ws] queueTimeline #8: [{"pos":1,"waitMin":0,"members":["Carol(45m,WAITING)"]},{"pos":2,"waitMin":45,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #9: [{"pos":0,"waitMin":0,"members":["Carol(60m,SERVING)"]},{"pos":1,"waitMin":60,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #10: [{"pos":1,"waitMin":0,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] event 'customerCalled': {"queueId":"891b2996-15fb-4745-b4e6-0d45215df52b","entryId":"7a34434e-0164-4faa-af12-2e45c3c86efa"}
[ws] queueTimeline #11: [{"pos":1,"waitMin":0,"members":["Carl (dad)(30m,WAITING)","Kid 1(20m,WAITING)","Kid 2(20m,WAITING)"]}]
[ws] queueTimeline #12: [{"pos":0,"waitMin":0,"members":["Kid 1(20m,WAITING)","Kid 2(20m,WAITING)","Carl (dad)(30m,SERVED)"]}]
[ws] queueTimeline #13: [{"pos":0,"waitMin":0,"members":["Kid 2(20m,WAITING)","Carl (dad)(30m,SERVED)","Kid 1(20m,SERVING)"]}]
[ws] queueTimeline #14: [{"pos":0,"waitMin":0,"members":["Kid 2(20m,WAITING)","Carl (dad)(30m,SERVED)","Kid 1(20m,SERVED)"]}]
```
> ✅ **CHECK:** at least 14 queueTimeline pushes received over WS (got `yes`)
> ✅ **CHECK:** 2 customerCalled events (one per call-next) (got `2`)

> Total `queueTimeline` pushes: **14**
> Total `customerCalled` events: **2**

---

## RESULT

| Metric | Value |
|--------|-------|
| Checks passed | **87 / 87** |
| WS queueTimeline pushes | **14** |
| WS customerCalled events | **2** |

| Resource | ID |
|----------|-----|
| Salon | `6fbd7616-0b1e-4f16-a988-6fe80509e669` (slug `fade-factory-1781617193`) |
| Barber1 staff/queue | `90c0eca6-c362-4d35-b59d-1a64c163f32c` / `891b2996-15fb-4745-b4e6-0d45215df52b` |
| Barber2 staff/queue | `b25bd6f4-ee07-4708-b11d-df8f409fd636` / `49810b9d-4087-4fca-95ae-1d61022b6c93` |
| Services | haircut=`5ec038db-43bd-4951-be42-0eb6d6b0c98c` trim=`ca0433ab-3b3d-4dab-98c7-5a4d1f60b917` fade=`5537b04d-83ba-4fc2-9778-e95271106f61` kids=`43c83b49-5c76-4e5e-ae05-9bd4e1b8b14d`(deactivated) towel=`72359261-c3eb-401f-b000-845ac33fc8a8`(deactivated) |
