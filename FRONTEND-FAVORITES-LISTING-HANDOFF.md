# Frontend Handoff — Salon Listing Homepage, Favourites & Shared Pagination

This supersedes the earlier version of this doc. It's now an actual IA/UI plan, not
just an API reference — where things live in the app, not only how to call them.

Interactive API docs: `GET /docs`. Spec: `swagger.json` at repo root (regenerated).

---

## 1. The big structural change: **salon listing IS the homepage**

The homepage layout becomes:

```
┌─────────────────────────────────────┐
│  [small hero/intro text]             │  ← short, pushed to the top
├─────────────────────────────────────┤
│  [search bar]  [state/city filter]   │
├─────────────────────────────────────┤
│  Salon card    Salon card    ...     │  ← GET /salons, paginated grid
│  Salon card    Salon card    ...     │
└─────────────────────────────────────┘
```

Everything else that used to be "other homepage content" gets pushed **below** the
small intro text and the listing — the listing is the primary above-the-fold content,
not a secondary section.

**Backed by:** `GET /v1/salons?state=&city=&search=&page=&limit=` — see §3 for the full
contract. This endpoint is public — the homepage works for anonymous visitors exactly
as well as logged-in ones.

---

## 2. Favourites — where the heart lives, and where the list lives

### The heart icon
| Surface | Show heart? |
|---|---|
| Salon card on the listing/homepage | **Only for authenticated users** |
| Salon detail page (`GET /salons/slug/:slug`) | **Only for authenticated users** |
| Anonymous visitor | No heart shown at all (not a disabled/greyed heart — just absent) |

> If product wants a different anonymous experience later (e.g. show the heart, tapping
> it prompts login) that's a one-line change to make explicitly — but as stated, the
> heart doesn't render at all when there's no session.

Both `POST` and `DELETE` are **idempotent** (see §4) — implement this as a simple
toggle with optimistic UI: flip the icon state immediately on tap, fire the request in
the background, only revert if the request genuinely fails (network/server error).

### The "My Favourites" list — navigation placement
| Viewport | Where | Auth-gated? |
|---|---|---|
| Desktop | **Sidebar** — a "Favourites" entry | Yes — only shown when logged in |
| Mobile | **Bottom/mobile nav** — a "Favourites" entry | Yes — only shown when logged in |

Both point to the same page/view, fed by `GET /v1/users/me/favorites`, rendered with
the **same card component** as the homepage listing (identical shape — see §3).

---

## 3. Salon listing + search — `GET /salons`

**Public. No auth required.**

```
GET /v1/salons?state=Plateau&city=Jos&search=kings&page=1&limit=20
```

All four filters are **optional** and combine with AND when present:

| Param | Type | Behavior |
|-------|------|----------|
| `state` | string | Exact match, **case-insensitive** (`"plateau"` and `"Plateau"` both work) |
| `city` | string | Same — exact, case-insensitive |
| `search` | string | Substring match on salon name (case-insensitive) — `"king"` matches `"Kings Cuts"` |
| `page`, `limit` | number | Standard pagination (see §5) |

### Response — one card per salon

```jsonc
{
  "data": [
    {
      "slug": "kings-cuts",
      "name": "Kings Cuts",
      "address": {
        "country": "Nigeria",
        "state": "Plateau",
        "city": "Jos",
        "street": "1 Example Street"
      },
      "isOpen": true,
      "photoUrl": "https://.../photo.jpg"   // null if the salon has no photo uploaded
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 47, "totalPages": 3 }
}
```

This card shape is used **identically** in three places: the homepage listing, the
favourites page, and (implicitly) anywhere else you want a salon card. One component,
three data sources.

Clicking a card goes to the existing full detail page:
```
GET /salons/slug/:slug   (unchanged, already documented)
```

### `isOpen` is a lighter check than the slug page does

The listing's `isOpen` is computed from the salon's regular weekly hours only — it does
**not** check one-off closures (e.g. today is a logged holiday). A salon closed today
specifically may still show `isOpen: true` on the card. The full slug page **does**
check closures correctly. Treat the card's badge as a hint, not the final word.

### "Default to their location" — entirely a frontend concern

The backend has **no geolocation, reverse-geocoding, or lat/lng** — none of that exists
(kept simple for MVP; `Address` stores text fields only). Your job on the homepage:
1. Read the browser's geolocation (or let the user pick a state manually).
2. Reverse-geocode to a state name (and optionally city) via whatever service you pick.
3. Pass it as `?state=&city=` on the listing call.

No location yet (permission denied / still resolving) → omit the params → full
unfiltered list shows, which is the correct default/fallback state for the homepage.

---

## 4. Favourite / bookmark a salon — the API contract

**Requires login (Bearer JWT).** Any logged-in user can favourite any salon, including
one that's currently **frozen** (over its org's plan limit) — bookmarking has nothing
to do with whether you can join that salon's queue.

### Add
```
POST /v1/salons/:salonId/favorite
```
- `salonId` is the salon's UUID (not the slug — read it off the salon detail response).
- **204 No Content** on success.
- **Idempotent** — favouriting an already-favourited salon returns 204 again, never an
  error. No need to check state before calling it.

### Remove
```
DELETE /v1/salons/:salonId/favorite
```
- **204 No Content** on success.
- Also idempotent — removing a non-existent favourite is still 204, not a 404.
- **Hard delete, no history, no undo** on the backend. If you want an "undo" toast
  client-side, just call `POST` again if the user taps undo.

### List mine
```
GET /v1/users/me/favorites?page=1&limit=20
```
Same paginated envelope as §5, same card shape as §3.

If a favourited salon is later deleted by its owner, it silently disappears from this
list on the next fetch — no error, no broken card.

---

## 5. Shared pagination — build ONE component

Every paginated list endpoint (salon listing, favourites, notifications inbox) returns
the identical envelope and accepts the identical params. Build a single reusable
pagination component/hook against this shape and use it everywhere:

```jsonc
{
  "data": [ /* page of items */ ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 47,        // total matching rows across ALL pages
    "totalPages": 3
  }
}
```

| Param | Default | Max | Notes |
|-------|:-------:|:---:|-------|
| `page` | 1 | — | 1-indexed |
| `limit` | 20 | 50 | server clamps anything higher |

Do not build per-page pagination logic three times — the shape is guaranteed identical
across every list endpoint in the API going forward, this was a deliberate backend
change specifically so you only need one component.

---

## 6. Full endpoint summary

| Method | Path | Auth | Purpose |
|--------|------|:----:|---------|
| GET | `/v1/salons` | none | Homepage listing: search + state/city filter (paginated) |
| GET | `/v1/salons/slug/:slug` | none | Full salon detail (unchanged, existing) |
| POST | `/v1/salons/:salonId/favorite` | JWT | Bookmark a salon (idempotent) |
| DELETE | `/v1/salons/:salonId/favorite` | JWT | Remove bookmark (idempotent) |
| GET | `/v1/users/me/favorites` | JWT | Favourites page (paginated) |
| GET | `/v1/notifications` | JWT | Inbox — unchanged behavior, same `{data, meta}` shape as above |

---

## 7. Build checklist

- [ ] **Homepage rework**: small intro text at top, existing homepage content pushed
      below it, salon listing (search + filter + card grid) becomes the primary content.
- [ ] **Shared pagination component/hook** (§5) — build once, use for listing,
      favourites, and notifications.
- [ ] **Shared salon-card component** (§3) — used by both the homepage listing and the
      favourites page.
- [ ] **Heart/favourite toggle** on the card component and the salon detail page —
      auth-gated (hidden entirely when logged out), optimistic UI, idempotent calls.
- [ ] **Favourites nav entry** — desktop sidebar + mobile nav, both auth-gated, both
      routing to the same favourites page.
- [ ] **Location default** — browser geolocation → reverse-geocode (your choice of
      service) → pre-fill the state/city filter on homepage load.

## 8. Gotchas

- `state`/`city` are exact match, not substring — `"Plat"` will **not** match
  `"Plateau"`. Only `search` does substring matching, and only on salon **name**.
- `photoUrl` can be `null` — always have a placeholder ready.
- Listing's `isOpen` ignores one-off closures (§3) — a hint, not the final word.
- No geolocation/lat-lng exists on the backend. "Near me" distance-sorting is a backend
  follow-up if wanted later, not something to fake client-side.
- The heart is **absent**, not disabled, for anonymous users — don't render a
  greyed-out heart that does nothing on tap.
