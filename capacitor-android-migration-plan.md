# Capacitor → Android Native Migration Plan

**Scope:** Android only · Capacitor only (no Ionic Framework) · the existing PWA must keep working
unchanged for web users (§0a).

---
### how to build

```sh ng build --configuration native
npx cap sync android
cd android && ./gradlew assembleRelease
```
output = /home/ikwuh-jeffery/UG/HairMela/frontend/android/app/build/outputs/apk/release/app-release.apk



## Status board

Last updated 2026-08-16. Full detail for each step is in §6; this is the at-a-glance view.

| # | Step | Status |
|---|---|---|
| 1 | Toolchain — JDK 21 + Android SDK | ✅ **Done** |
| 2 | Install Capacitor (8.5.0) | ✅ **Done** |
| 3 | `environment.native.ts` + `native` build config | ✅ **Done** |
| 4 | `cap add android` — scaffold + APK | ✅ **Done** |
| 5 | First run on device (launch, data, **login**) | ✅ **Done** |
| 5a | Native cold-start behaviour (§5a) | ✅ **Closed — no change needed** |
| 6 | Hardware back button + overlay registry | ✅ **Done** |
| — | Status bar / safe areas | ✅ **N/A** — confirmed fine by user |
| — | `AppPlatformService` — "native or web?" | ✅ **Done** |
| — | Pull-to-refresh on Android native | ✅ **Done** |
| 7 | Storage → Capacitor Preferences | ✅ **Done** |
| 8 | QR scanner → native plugin | ✅ **Done** |
| 9 | Push → FCM | ✅ **Done** — verified cross-device |
| 10 | Release build | ✅ **Signed APK + AAB built** — Play Console pending, still on dev API |
| 10a | Android App Links | ✅ **Built + unblocked** — needs a deploy, then device test |

**Where this stands: the app is functionally complete.** It builds, installs, launches, logs in,
shows live data, scans QR codes with the native camera, persists sessions durably, handles the back
button, exchanges **live queue updates over Socket.IO in both directions with web clients**, and
**receives push notifications** — all verified on a real device.

**Only shipping work remains.** Step 10's engineering is done — keystore, Gradle signing, R8,
signed release APK (27M) and AAB (18M), with login/QR/push all re-verified on the signed build.
What is left is a Play Console account (applied for, pending approval), the store listing, and
switching `environment.native.ts` from the dev backend to production.

Step 10a (App Links) is built and its Vercel blocker is resolved; it needs a frontend deploy so the
live domain serves `assetlinks.json`, then an on-device test.

### `AppPlatformService` — the one place to ask "native or web?"

`core/native/app-platform.service.ts`. Inject it instead of reading `environment.native` directly:
`isNative`, `isWeb`, `shell` (`'android' | 'web'`).

Backed by the **build-time** `environment.native` constant, not `Capacitor.isNativePlatform()`, so
`if (!platform.isNative)` branches are statically dead in a web build and the bundler drops
everything behind them — including any `import('@capacitor/...')` inside. A runtime check cannot do
that (see step 6's measured 8.6 kB regression).

**Not to be confused with `InstallPromptService`'s `Platform`** (`'android' | 'ios' | 'desktop'`),
which sniffs the user agent to choose PWA *install instructions*. A phone browsing the website is
`'android'` there but `'web'` here — different questions.

*Consequence:* fixed per build, so native paths cannot be faked in a browser and must be verified
on a device.

It also stamps `capacitor-native` on `<html>` at boot, so stylesheets can target the native shell.
Instantiated early because `PersistentStore` (the first `provideAppInitializer`) injects it.

### Pull-to-refresh on Android native

`PullToRefreshService` was **iOS-standalone-only**. In the Capacitor app there is no browser chrome,
no built-in overscroll refresh, and (by design) no service worker — so there was **no way to refresh
at all**. Its gate is now `isNative || isIosStandalone`.

Nothing else needed changing: all three shells (auth, guest, public) already called `init()` with
the correct scroll source. Android's *installed PWA* stays excluded — it has its own native gesture.

Added `overscroll-behavior-y: none` under `html.capacitor-native`, because `preventDefault()` alone
does not fully suppress the Android WebView's stretch animation.

**Note on `window.location.reload()` in the WebView:** it reloads from the *bundled* assets — fast,
no network — then re-runs bootstrap and re-fetches app data. It does **not** pick up a new app
version; that needs a Play Store update.

#### Resolved a pre-existing FIXME while here

The service carried a documented FIXME: pull-to-refresh was **not suppressed while a modal was
open**, so a downward swipe inside a dialog could reload the app and discard in-progress state (a
half-filled booking form being the worst case) — the realistic trigger being the native-app reflex
of swiping down to dismiss a sheet. It was deferred because it "needs a single shared *is any modal
open* signal" and the modals were scattered with no shared registry.

**That registry now exists** — `OverlayRegistry`, built for the Android back button, with all seven
dialogs registered. The fix is a `_overlays.hasOpen()` check at **arm** time in `_handleTouchStart`,
so the drag never starts under a modal rather than being cancelled at commit time. This benefits
**iOS PWA users too**, not just native.

**Live queue sockets: verified on device, bidirectionally.** A client added from the native app
appeared on the web app, and a client added on web appeared in the native app. Socket.IO works from
the `https://localhost` WebView origin against the dev backend, and native + web clients share the
same queue rooms in real time — which also confirms the gateway's own CORS (a separate config from
HTTP CORS) is correct.

### Backend / infrastructure status

| Item | Status |
|---|---|
| CORS on **dev** backend | ✅ Done — verified by preflight |
| CORS on **production** backend | ✅ Done — verified by preflight |
| Firebase project + `google-services.json` | ✅ Done — `hairmela-app` |
| Backend FCM token field + send fan-out | ✅ Done — live on dev |

---

## 0a. Hard constraint: the PWA is not being replaced

**The existing web app keeps a substantial user base and must continue working exactly as it does
today.** Native is an *addition*, not a migration. This constraint outranks every other goal in
this document; where convenience and this constraint conflict, this constraint wins.

Concretely, all of the following stay live and unmodified in behavior for web users:

- `ngsw-worker.js` service worker and offline caching
- `UpdateService` background polling + auto-reload on new deploy
- `InstallPromptService`, the `/download` route, and the how-to-install page
- Web Push over VAPID via `SwPush` — same subscribe/unsubscribe endpoints, same payload shape
- The Vercel deploy, its `--define` env substitution, and `vercel.json` cache headers
- The web manifest and PWA install flow

**The engineering rule that enforces this:** native behavior is introduced by *adding* a parallel
path selected at runtime or build time — never by editing the web path in place. A file that web
users depend on may gain a branch, but must not lose a capability.

**The verification rule:** the web production build is validated *before and after* every step
below. Any step that changes web behavior is rolled back and redone additively. See §6a for the
concrete regression gate.

---

## 0. Why no Ionic

Ionic Framework and Capacitor are separable. Capacitor is the native runtime (WebView shell +
native plugin bridge). Ionic Framework is a UI component library (`ion-button`, `ion-card`) with
its own theming layer.

This codebase is Tailwind 4 throughout, with an established decision to build custom components
(Button/Table/Tabs) on Tailwind plus Angular CDK for behavior, and explicitly no UI library.
Adopting Ionic would mean either rewriting the existing feature components or running two
competing design systems at once.

**Capacitor alone delivers everything needed here.** Capacitor plugins are framework-agnostic —
they are plain TypeScript APIs, with no dependency on Ionic's components. Nothing in this plan
requires Ionic.

---

## 1. Starting position (verified, not assumed)

| Fact | Evidence | Consequence |
|---|---|---|
| **SSR is already off** | `angular.json` has no `server` / `ssr` / `outputMode` key; `dist/frontend/` contains only `browser/`; `vercel.json` sets `outputDirectory: dist/frontend/browser` with a SPA rewrite | **No SSR teardown needed.** The build already emits a static SPA — exactly Capacitor's input. `@angular/ssr`, `@angular/platform-server`, `express` and the `serve:ssr:frontend` script are unused leftovers. Noted, not removed (pre-existing, out of scope). |
| Angular 22, standalone bootstrap | `src/main.ts`, `src/app/app.config.ts` | No NgModule work. |
| Tailwind 4 via PostCSS | `.postcssrc.json`, `postcss.config.mjs` | Unaffected by Capacitor. |
| Prod config uses `--define` substitution | `src/environments/environment.production.ts` | **The single largest gotcha — see §3.1.** |
| Service worker enabled in prod | `provideServiceWorker` in `app.config.ts` | Must be disabled for native — see §3.4. |
| No JDK, no Android SDK on this machine | `java -version` → not found; `ANDROID_HOME` / `ANDROID_SDK_ROOT` unset; no `~/Android/Sdk` | **Prerequisite install required before any build can run — see §2.** |
| Node v24.16.0, npm 11.13.0 | `node -v`, `package.json` | Satisfies Capacitor 7 requirements. |

---

## 2. Prerequisites — ✅ COMPLETE (step 1 done 2026-08-16)

**Gate passed:** `java -version` reports 21 **and** `adb devices` lists an authorized target.

| Component | Installed | Notes |
|---|---|---|
| JDK | OpenJDK **21.0.11** | `openjdk-21-jdk-headless`, includes `javac` |
| Android SDK | `~/Android/Sdk` (458M) | via standalone `cmdline-tools`, no Android Studio |
| platform-tools | 37.0.1 | `adb` working |
| platforms | android-**35** + android-**36** | 36 added to match the test device |
| build-tools | 35.0.0 + 36.0.0 | |
| Licenses | all accepted | |

**Test device:** Xiaomi `24117RN76G`, **Android 16 / API 36**, `arm64-v8a`, 82G free, USB debugging
authorized. MIUI's `adb_install_need_confirm` and `verifier_verify_adb_installs` are both unset
(no install block).

### Two environment traps found and fixed — do not undo these

1. **Env vars live in `~/.profile`, NOT `~/.bashrc`.** Ubuntu's stock `.bashrc` returns early for
   non-interactive shells, so exports placed there are invisible to Gradle and other tooling. The
   first attempt did exactly this and silently failed; caught by testing in a fresh login shell
   (`bash -lc`) rather than the current one. Always verify env changes that way.
2. **A stub SDK at `/usr/lib/android-sdk` shadowed the real one.** It contains only
   `platform-tools` (no `sdkmanager`, no platforms), and its `/usr/bin/adb` won on `PATH`.
   `$ANDROID_HOME/platform-tools` is therefore **prepended** to `PATH` so the real `adb` wins.
   Verified: `which adb` → `~/Android/Sdk/platform-tools/adb`.

The block appended to `~/.profile`:

```sh
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

Existing terminals need `source ~/.profile` (or a re-login) to pick this up.

**API level note.** The device runs API 36 while Capacitor's default target may be lower. Whatever
`cap add android` generates in `android/variables.gradle` should be checked against API 36 at step
4 — and Play Store target-API requirements re-checked at step 10, since Google raises the minimum
annually.

**Capacitor version: 8.5.0, not 7.** Installed 2026-08-16. JDK 21 remains correct for this line.

**`npm audit` note.** Installing the CLI surfaces one *moderate* advisory against `@capacitor/cli`
via its transitive **`xcode`** dependency (a build-time tool for editing Xcode project files). It
is iOS-only, never shipped in the app, and irrelevant to this Android-only build. The offered "fix"
is a **downgrade to 8.4.2 flagged semver-major** — a worse trade than the advisory. Deliberately not
applied. The other 27 advisories are pre-existing and unrelated to Capacitor.

---

## 3. The four real problems

Ranked by cost. Each states the failure, the fix, and how to verify it.

### 3.1 Origin and API base URL — *breaks everything, cheapest to fix*

**The failure.** In a Capacitor Android WebView the app is served from `https://localhost`, not
`https://hairmela.com`. Three separate consequences:

- **API calls.** The prod build gets `apiBaseUrl` from `NG_APP_API_BASE_URL`, injected by
  `ng build --define` from Vercel dashboard env vars. That mechanism does not exist locally — a
  native build run without the defines produces a bundle containing the bare unresolved
  identifier, and `ng build` **does not fail**. It throws at runtime on first API call with
  `ReferenceError: NG_APP_API_BASE_URL is not defined`. This is documented at length in
  `environment.production.ts` and confirmed there by prior testing.
- **CORS.** The backend must add the WebView origin (`https://localhost`) to its allowed origins,
  or every request fails preflight.
- **Socket.IO.** `queue-socket.service.ts:72` connects to `${environment.socketUrl}/queues` —
  same absolute-URL and CORS requirements as above.

**The fix.** Add a **new** `environment.native.ts` with hardcoded URLs (no `--define` indirection —
there is no Vercel dashboard in this build path), plus a **new** `native` build configuration in
`angular.json` that file-replaces into it.

**Confirmed values** (probed live, 2026-08-16 — native targets the **development** backend by
decision):

```ts
apiBaseUrl: 'https://hairmela-backend-development.up.railway.app'  // /v1 → 200
socketUrl:  'https://hairmela-backend-development.up.railway.app'  // same host; handshake returns a sid
appBaseUrl: 'https://dev-hairmela.vercel.app'                      // ← a real, reachable web origin (200)
```

`appBaseUrl` is the **dev web deployment**, matching the dev backend — not the WebView origin. It
still satisfies §3.2's requirement (share links and QR payloads resolve to a real website someone
can open on another device); it simply points at the dev site while native is unreleased. At step 10
it moves to `https://hairmela.com` alongside the backend switch.

**Backend CORS — DONE and verified.** No code change was needed: both `main.ts` (HTTP) and
`queue.gateway.ts` (Socket.IO) already read the same `CORS_ORIGIN` env var — unified deliberately
on 2026-08-05 (`scaling.md:885`) as one source of truth. Origins were added via Railway env config.
Verified against the development backend by preflight:

| Origin | Result |
|---|---|
| `https://localhost` | ✅ allowed (Android WebView, debug **and** Play Store release) |
| `capacitor://localhost` | ✅ allowed (iOS scheme; harmless to have) |
| `http://localhost` | ✅ allowed (Capacitor live-reload) |
| `https://hairmela.com` | ✅ **still allowed** — existing web origin intact |
| `https://evil.example.com` | ✅ correctly **blocked** — still a real allowlist, not a wildcard |

**Production backend: same origins added, also verified.** `hairmela-backend-production...` returns
`access-control-allow-origin` for all three native origins, still allows `https://hairmela.com`, and
still blocks an unknown origin. So step 10's backend-side CORS work is **already done** — that step
reduces to changing the two URLs in `environment.native.ts`.

`https://dev-hairmela.vercel.app` is likewise an allowed origin on the dev backend (verified), which
is what lets the dev web deployment and the native build share one backend.

**Additive by construction.** A new environment file and a new build configuration; the existing
`production` configuration, its `fileReplacements`, and its `--define` contract are untouched. The
CORS change appended origins without removing any — confirmed above by `https://hairmela.com` still
being allowed.

**Why development, not production, for the native target:** the native app is unreleased and will
be exercised by test devices against real data-shaped endpoints. Pointing it at development keeps
that traffic — and any bad state from a half-built client — off the production database. Switching
to production is a one-line change in `environment.native.ts` **plus** adding the same three origins
to production's `CORS_ORIGIN`, and should happen as part of step 10 (release), not before.

**Do not** reuse or modify the `production` configuration for native builds — its `--define`
dependency is a runtime landmine here, and editing it would put web deploys at risk.

**Verify:** grep the native bundle for `NG_APP_` — zero hits. App loads and authenticates on device.
**Web regression check:** `ng build --configuration production` still succeeds and still contains
the `NG_APP_` identifiers when built without defines (i.e. its behavior is unchanged).

---

### 3.2 `environment.appBaseUrl` — share links must not point at the WebView

**The failure.** Four call sites build user-facing URLs from `appBaseUrl`:

- `salon-overview.component.ts:88` — copy-to-clipboard
- `salon-share.component.ts:36` — salon share link
- `live-queue.component.ts:186` — copy-to-clipboard
- `salon-landing.component.ts:300` — the **QR code payload**

If `appBaseUrl` were set to the WebView origin, every shared link and every printed QR code would
encode `https://localhost/...` — worthless off-device, and the QR posters are physical artifacts
that would ship broken.

**The fix.** In `environment.native.ts`, `appBaseUrl` **must remain the real public web domain**
(`https://hairmela.com`), even though `apiBaseUrl` and the app's own origin differ. These are
genuinely different values in native and must not be collapsed into one.

**Verify:** scan a generated QR from a native build with a separate phone — it must open the real
website.

---

### 3.3 QR scanner — replace the implementation, keep the interface

**The failure.** `qr-scanner.component.ts` uses `html5-qrcode`, which drives `getUserMedia`.
Camera access in an Android WebView is unreliable and requires native permission plumbing that the
web library does not do.

**The fix.** Replace the internals with a Capacitor barcode plugin (`@capacitor-mlkit/barcode-scanning`).
Keep the component's public surface identical — `scanned = output<string>()` and
`closed = output<void>()` — so the only consumer (`dashboard.component.html:143` /
`dashboard.component.ts:30`) needs no change. Camera permission goes in `AndroidManifest.xml`, with
a runtime request before the first scan.

**Blast radius: one consumer.** This is contained.

**Verify:** scan a salon QR on a physical device; confirm the same navigation as the web build.

---

### 3.4 Push notifications — the expensive one, with a backend dependency

**The failure.** `push.service.ts` is built entirely on Angular's `SwPush` — Web Push, VAPID keys,
and a `{endpoint, p256dhKey, authKey}` subscription shape sent to `POST /push/subscribe`. **Web
Push does not exist in an Android WebView.** `SwPush.isEnabled` will be false, and every entry
point already guards on it — so push degrades to a silent no-op rather than crashing. That is a
safe failure, but it means **no notifications**, which is core to this product ("it's your turn").

**Note on the service worker — web keeps it.** The native build should skip the service worker:
native assets are bundled locally, so a caching SW adds a second stale-asset layer and a confusing
update path, and `UpdateService`'s auto-reload-on-deploy is meaningless in an installed app. This
is achieved **per build configuration**, not by editing shared code — `provideServiceWorker`'s
`enabled` flag becomes environment-driven, so the `native` config disables it while the
`production` config keeps `ngsw-worker.js`, the `vercel.json` cache headers, and `UpdateService`
auto-reload exactly as they are today. **No web user loses offline caching or auto-update.**

**This is the one item that could damage web users if done carelessly** — `push.service.ts` is a
file the entire web push flow depends on. It must be **restructured, never rewritten.**

**What makes that safe: the consumers depend on an interface, not an implementation.** Verified
call sites use only:

| Consumer | Uses |
|---|---|
| `auth.service.ts:56-57`, `:76` | `permission`, `enable()`, `disable()` |
| `notifications-toggle.component.ts:13` | injects; `subscribed` / `enable` / `disable` via template |
| `push-prompt.component.ts:20` | injects; prompt flow |
| `my-position.component.ts:57` | injects; contextual enable |

Nothing reaches into `SwPush` or the VAPID details from outside. That means the web implementation
can be preserved *verbatim* behind that interface.

**The fix** — a two-sided change, structured so web is untouched:

*Frontend (additive):* keep the current `SwPush`/VAPID logic **as-is** as the web implementation.
Add a **separate** `@capacitor/push-notifications` (FCM) implementation as a sibling. Select
between them with **`AppPlatformService.isNative`** (a build-time constant — NOT
`Capacitor.isNativePlatform()`, see §6 step 6's regression) and `await import()` the plugin. The
public interface — `isSupported`, `permission`, `enable()`, `disable()`, `subscribed` — stays
byte-identical, so all four consumers change **zero lines**. On web, the selected code path is the
same code that runs today.

*Backend (required, additive):* accept an FCM device token **in addition to** the existing
`{endpoint, p256dhKey, authKey}` web-push shape, and fan out sends to both transports. The existing
web-push subscription contract and its stored rows must keep working unchanged — this is a new
field/route alongside, not a replacement.

*Also required:* a Firebase project, `google-services.json` in the Android app, and the FCM Gradle
plugin. None of these touch the web build.

**Deep links.** `_navigateFromNotification()` maps a payload to an in-app route. The FCM path needs
equivalent wiring via `pushNotificationActionPerformed`. The existing `notificationClicks` handler
for web stays exactly as written; the routing helpers `_navigateFromNotification` and
`_positionRouteFor` can be shared by both paths since they are transport-agnostic.

**Recommendation:** treat push as its own follow-up milestone after the shell runs. It is the only
item with a hard backend dependency, the app is usable (if degraded) without it, and isolating it
keeps the riskiest change away from the initial native bring-up.

---

## 4. Storage — the async trap

**Worth calling out because the obvious fix is wrong.**

`PersistentStore` is the single gateway to `localStorage`, with **10 call sites**, and its own
docstring already anticipates this migration ("a WebView shim for Capacitor").

**Correction — the original framing here overstated the problem.** `localStorage` in an Android
WebView is real disk storage and **does survive force-stop and relaunch**; this was observed
directly on device before step 7 was implemented. The everyday session path was never broken.

The narrower, real gain is durability against the **OS or a cleaner app wiping the WebView's web
data** — Settings → Apps → Clear data, MIUI's storage-cleanup tools, and low-storage reclamation.
`localStorage` does not survive those; `@capacitor/preferences` does, because it is backed by
Android `SharedPreferences` rather than WebView storage. On a Xiaomi/MIUI device — which is the
test device here, and aggressive about cleanup — that is a genuine scenario, not a theoretical one.

**Known one-time cost:** switching backing stores logs out anyone already signed in on native,
because the new build reads Preferences while the old session sits in `localStorage`. Paid once,
pre-release, by the single test user. Had this shipped first, it would have logged out the entire
native user base — an argument for doing it now rather than later. A `localStorage`→Preferences
read-through migration (~15 lines) would avoid even that, and should be added **if native ships
before this is revisited**. **Web users are unaffected either way** — web still reads
`localStorage` with the same keys.

**The trap:** `PersistentStore` is **synchronous** (`getRaw(): string | null`). Capacitor Preferences
is **asynchronous** (`Promise<...>`). A direct swap forces `async` up through
`TokenStore.getRefreshToken()` → `jwt.interceptor` → `refresh.interceptor` → `session-init` →
`guest-store`. HTTP interceptors in particular are painful to make async.

**The fix that avoids the ripple:** hydrate Preferences into an in-memory cache **once** during app
initialization (before `sessionInit`, which is the first thing needing a refresh token), keep every
`PersistentStore` getter synchronous against that cache, and make writes fire-and-forget through to
Preferences. Every one of the 10 call sites stays untouched.

**Web stays on `localStorage`.** The Preferences backing is selected only when
`Capacitor.isNativePlatform()` is true; on web, `PersistentStore` continues to hit `localStorage`
directly exactly as it does today — same keys, same values, same synchronous behavior. Existing web
users' stored sessions, guest tokens, and preferences are unaffected, and no migration of their
data occurs. This is precisely the swap the class's own docstring was written to allow.

**Verify (native):** log in, force-stop the app, clear the WebView's web data from Android settings,
reopen — session must survive.
**Verify (web):** an existing logged-in browser session survives the deploy without re-login, and
the `hm_refresh_token` / `hairmela_guest` keys are still read from and written to `localStorage`.

---

## 5. Secondary items

- **`session-init.ts` cold-start redirect — decision required, see §5a.** Reads
  `window.location.pathname` and uses the Navigation Timing API (`nav.type === 'navigate'`) to
  distinguish a fresh visit from a refresh. In a WebView there is no address bar and no
  user-initiated refresh, so this heuristic's meaning changes. This is the one open item in the
  plan and is resolved in §5a rather than left to be inherited by accident.
- **`InstallPromptService`.** Entirely about PWA installation (`beforeinstallprompt`, iOS
  Add-to-Home-Screen). Meaningless in an already-installed native app, so its UI, the `/download`
  route, and the how-to-install page should be **hidden on native only** — via an
  `isNativePlatform()` check at the render/route level. **The service, the route, and the page all
  remain fully functional on web**, where they are how new PWA users install the app. Nothing is
  deleted.
- **`<base href="/">`** in `index.html` — verify it resolves correctly under the WebView origin.
- **Hardware back button.** Android's back button is not handled today. Without wiring it to the
  Angular router it will close the app instead of navigating back — a Play Store review risk.
- **Status bar / safe areas.** Android draws content under the status bar; needs
  `@capacitor/status-bar` plus safe-area padding.
- **External fonts.** `index.html` loads Poppins from Google Fonts over the network. On native this
  is a remote fetch that fails offline; consider bundling it locally. Note `index.html` is shared by
  both builds — bundling the font locally would also change the web build, so if done it must be
  verified as a web improvement in its own right (it generally is), not slipped in as a native-only
  change. Otherwise leave it alone.
- **`.gitignore`.** Needs entries for Capacitor build output if the `android/` directory is
  committed (it normally is).
- **Cloudinary image loader** — already absolute URLs, unaffected.

---

## 5a. Resolved: native cold-start behavior in `session-init.ts`

This was the one item previously left open. Resolving it here so it is not inherited by accident.

**What the code does today.** `shouldRedirect` (line 52) is the AND of three conditions, and
**each one changes meaning in a WebView**:

| Input | Web meaning | Native reality |
|---|---|---|
| `atRoot` (`pathname === '/'`) | User typed/landed on the bare domain | **Always true on launch** — a WebView always cold-starts at `/` |
| `isFreshNavigation()` (Navigation Timing `type === 'navigate'`) | Distinguishes a fresh visit from an F5 refresh | **Always `'navigate'`** — there is no address bar and no user-initiated refresh |
| `hasPaymentReturnParams` (`?tx_ref=`) | Flutterwave redirect landed on root | Never set on launch; a native payment return arrives via deep link, not a page load |

So on native, `shouldRedirect` is **unconditionally true at every app launch** — where on web it is
true only on a deliberate fresh visit to the root.

**Is that actually wrong?** No — it is very close to the desired native behavior, but for the wrong
reason, and that distinction matters:

- **Returning guest** → routed to `guestStore.getLastPath()`. Correct and desirable natively.
- **Logged-in user** → routed to last salon, else dashboard. Correct and desirable natively.
- **The bug risk:** on web, the `isFreshNavigation()` guard exists specifically so a *refresh* does
  not bounce the user away from where they chose to be. Natively there is no refresh — but there
  **is** an equivalent: the app resuming from background, and any future deep link. If the
  initializer re-runs in either case, the user gets yanked to the dashboard mid-task.

**RESOLUTION (2026-08-16): no code change needed. Closed as a non-issue.**

The concern above was that a native "resume" would re-run the redirect and yank the user out of
whatever they were doing. On closer inspection it cannot:

| Native scenario | Re-runs `sessionInit`? | Redirect fires? | Correct? |
|---|---|---|---|
| Cold start (always lands at `/`) | yes | ✅ yes | Yes — this is the intent |
| **Resume from background** | **no** | — | Yes |
| Pull-to-refresh on `/dashboard` etc. | yes | ❌ no (`atRoot` false) | Yes — stays put |
| Pull-to-refresh at `/` | yes | ✅ yes | Fine — same as a cold start |

The resume case — the whole basis of the worry — never happens: `sessionInit` is a
`provideAppInitializer`, which runs once per Angular **bootstrap**. Android resuming a backgrounded
app does not re-bootstrap; the WebView is still alive. Confirmed empirically too — the app was
backgrounded and resumed repeatedly during device testing and never bounced.

The only native path that *does* re-bootstrap is pull-to-refresh's `window.location.reload()`, and
there `atRoot` is false on any real page, so the redirect correctly does not fire.
(`update.service.ts`'s two `reload()` calls are service-worker-driven and dead in the native build.)

So the existing code already behaves correctly on native — via `atRoot` rather than
`isFreshNavigation()`. Adding a native-only "first run this process" flag would be code with no
observable effect, and `isFreshNavigation()` still earns its keep on web (where F5 is real). **Left
exactly as written.**

**Deep links are explicitly out of scope for this pass.** Android App Links are not being configured
in steps 1–10; the app launches only from its icon. If deep links are added later, this cold-start
redirect must be revisited at the same time, or a deep-linked launch will be overridden by the
redirect before the target route renders. **Noted as a known future dependency, not a silent trap.**

**Where it lands in the sequence:** step 5a (below), immediately after first run — because that is
the first moment the behavior is observable on a device.

**Verify:** cold-start as a returning guest → lands on their queue. Background the app mid-flow on
any screen, resume → **stays exactly where it was**, no bounce to dashboard.

---

## 6. Proposed sequence

Each step has a verification gate; do not advance on an unverified step.

1. ✅ **DONE — Toolchain.** OpenJDK 21.0.11 + Android SDK in `~/Android/Sdk` (platform-tools 37.0.1,
   platforms 35 **and** 36, build-tools 35.0.0 + 36.0.0, all licenses accepted). See §2 for the two
   environment traps fixed along the way (`.profile` vs `.bashrc`, and the `/usr/lib/android-sdk`
   stub shadowing the real `adb`). *Verified:* `java -version` = 21 and `adb devices` lists the
   authorized Xiaomi device.
2. ✅ **DONE — Install Capacitor.** `@capacitor/core`, `@capacitor/cli`, `@capacitor/android` all at
   **8.5.0** (not the v7 this plan originally assumed). `capacitor.config.ts` created with
   `appId: com.hairmela.app`, `appName: HairMela`, `webDir: dist/frontend/browser`.
   *Verified:* `cap doctor` clean; **web build output byte-identical to the pre-install baseline**
   (5,576,750 bytes, same three pre-existing warnings, `ngsw-worker.js`/`ngsw.json`/
   `manifest.webmanifest` all still emitted); no `capacitor` string anywhere in the web bundle.
3. ✅ **DONE — Native env + build config** (resolves §3.1 and §3.2). Added
   `src/environments/environment.native.ts` and a `native` configuration in `angular.json`; added
   `serviceWorker: true/false` to the environment shape and wired it into `provideServiceWorker`.
   *Verified:* native bundle has **zero `NG_APP_`** occurrences, **no `ngsw-worker.js`/`ngsw.json`**,
   and the dev backend + `dev-hairmela.vercel.app` URLs baked in. **Web regression gate passed** —
   production build keeps all four artifacts, same three baseline warnings, tests still
   1 failed/139 passed, `vercel.json` / `ngsw-config.json` / `manifest.webmanifest` untouched,
   `angular.json` purely additive (no lines removed), `tsc --noEmit` clean. Web output grew by
   **28 bytes** — the added `serviceWorker: true` flag, and nothing else.
4. ✅ **DONE — Add the platform.** `npx cap add android` + `cap sync`. Generated
   `android/variables.gradle` with `compileSdkVersion = 36` / `targetSdkVersion = 36` —
   **already matches the API 36 test device**, so §2's API-level concern is resolved with no edit.
   `.gitignore` updated: `android/` **is** committed (53 files — manifest, Gradle, icons), while
   build output, `local.properties` and the synced `assets/public` are ignored.
   *Verified:* debug APK built (8.0M) and installed to the device.

   **Trap found:** `cap add android` copies whatever is currently in `dist/frontend/browser` — which
   was the **production** web build left over from the previous regression check, so the first APK
   contained production URLs *and* a service worker. Fixed by rebuilding `--configuration native`
   then re-running `cap sync`. **Always `ng build --configuration native` immediately before
   `cap sync`**; a stale `dist/` silently ships the wrong bundle.

5. ✅ **DONE — First run.** App launches on the Xiaomi device and renders correctly.
   *Verified:* WebView origin is `https://localhost` (confirmed in logcat asset URLs); zero JS
   errors, zero `ReferenceError`, zero CORS failures; **live salon data with photos and "Closed"
   badges rendered from the dev backend** — end-to-end proof that the API + CORS path works.
   APK assets confirmed to contain `hairmela-backend-development`, `dev-hairmela.vercel.app`, no
   `ngsw-worker.js`, and no unresolved `NG_APP_` identifiers.

   **Login confirmed** (the original gate wording) — the user signed in on-device and the
   authenticated staff dashboard rendered (salon switcher, "Oga boss" / STAFF, bottom nav,
   Accepting-clients toggle). The session then **survived an app restart**, so the authenticated
   POST path, token persistence and session restore all work natively.
5a. ✅ **CLOSED — Native cold-start behavior** (§5a). Investigated and found to need **no code
   change**: `sessionInit` runs once per Angular bootstrap, and resuming a backgrounded app does not
   re-bootstrap, so the feared "resume yanks the user to the dashboard" cannot occur. The only
   native re-bootstrap is pull-to-refresh, where `atRoot` is false on any real page. See §5a.
6. ✅ **DONE — Back button.** Added `core/native/back-button.service.ts` + `@capacitor/app`, wired via
   `provideAppInitializer`. Priority: open dialog closes → else `Location.back()` → else `exitApp()`
   at the last history entry. Reuses the `window.history.length > 1` idiom already in
   `BackButtonComponent`. *Verified on device:* HairMela stays the `topResumedActivity` across
   multiple back presses at several depths, where it previously exited to the launcher.

   **Safe areas / status bar: confirmed fine as-is by the user — no work needed.**

   ### ⚠️ Regression caught and fixed: native code leaked into the web bundle

   The first implementation used **top-level** `import { Capacitor } from '@capacitor/core'` and
   `import { App } from '@capacitor/app'`, guarded at runtime by `Capacitor.isNativePlatform()`.
   Because `provideAppInitializer` references the service unconditionally, the bundler pulled
   Capacitor into the **web initial bundle**: budget warning jumped **552.78 kB → 561.41 kB
   (+8.6 kB)** and `@capacitor/*` appeared in the production `main-*.js`.

   **A runtime `isNativePlatform()` check cannot keep a module out of a bundle** — answering the
   question requires loading the module. Fixed by making the guard a **build-time constant**
   (`environment.native`, added as `false` to both web environments and `true` to
   `environment.native.ts`) and moving the plugin to a **dynamic `import()`** inside `init()`.

   *Result:* web initial bundle back to **553.25 kB**, and `@capacitor` appears in **no web chunk at
   all** — the bundler drops the dead branch entirely rather than merely lazy-loading it. The native
   build keeps it in a lazy chunk. **Web users ship zero Capacitor bytes.**

   **Rule for every future plugin (QR scanner, push, Preferences): guard on `environment.native` and
   `await import()` the plugin. Never a top-level import of a Capacitor package.**

   ### Second gap caught by the user: five dialogs were unhandled

   The first cut only handled `ConfirmDialogService` / `RenameDialogService` — the two singletons
   rendered from `app.html`. A `grep` for `@if (open())` found **five more** dialogs:
   `join-dialog`, `add-client-modal`, `book-appointment-dialog`, `gallery-modal`,
   `gallery-edit-modal`. Back would have navigated the page out from under any of them.

   **Why a base class does not solve this** (the natural first instinct): these dialogs take
   `open` as an `input.required<boolean>()` **owned by the parent**, and close by emitting
   `closed`. The state lives in whichever of the **12 parent templates** is hosting one, so a
   root-level service has nothing to reach for. Inheritance shares code, not instances.

   **Solution: `core/overlay/overlay-registry.ts`** — a stack of open overlays plus a
   `registerOverlayWhileOpen(open, close)` helper each dialog calls in **one line** from its
   constructor. A stack, not a slot, because overlays can nest (a lightbox opened from inside a
   booking dialog). The helper owns register/release/destroy once, instead of five hand-copied
   blocks each able to strand a stale entry.

   **Deliberately NOT native-gated.** "Dismiss the top overlay" is one behaviour with two triggers —
   Android back and the Escape key. Gating it on Capacitor would fork dialog behaviour by platform
   and leave the web path to rot, for a saving of one array push. `gallery-modal` already
   implemented Escape this way; the registry generalises that precedent rather than inventing a
   parallel native-only concept.

   *Verified on device:* with the add-client modal open, back **closed the modal and left the queue
   page in place**; a second back then navigated queue-list → console, proving the stack released
   cleanly rather than stranding an entry. Web gate passed, `@capacitor` still absent from the web
   bundle.
7. ✅ **DONE — Storage → Preferences.** `PersistentStore` now has two backings behind one unchanged
   **synchronous** API: web keeps `localStorage` verbatim; native hydrates `@capacitor/preferences`
   into an in-memory cache once at boot, serves reads from it, and persists writes
   fire-and-forget. All **10 call sites unchanged**. `hydrate()` is registered as the **first**
   `provideAppInitializer`, before `sessionInit` — the ordering is load-bearing, since `sessionInit`
   is the first reader of the refresh token. The nine persisted keys are enumerated in
   `PERSISTED_KEYS`; **any new persisted key must be added there** or it will not survive a restart
   on native (Preferences has no synchronous enumerate-all, unlike `localStorage`).
   See §4 for the corrected rationale and the one-time logout cost.

   **⚠️ Bug found and fixed after first implementation — provider order is NOT sequencing.**
   The first cut relied on registering `hydrate()` as the first `provideAppInitializer`, ahead of
   `sessionInit`. **Angular runs initializers in PARALLEL** and only awaits them collectively, so
   ordering the providers array guarantees nothing. `sessionInit` called `getRefreshToken()` while
   hydration was still awaiting its dynamic `import()` and the Preferences reads, saw an empty
   cache, and returned early — **every native cold start appeared signed out**, even though the
   token was correctly written to `CapacitorStorage.xml` the whole time (confirmed by reading the
   file off the device: the refresh token was present and unexpired).

   *Fix:* `sessionInit` **awaits `hydrate()` itself** before its first read, making the dependency
   explicit instead of positional. `hydrate()` caches its in-flight promise, so it is idempotent and
   the eager call in `app.config.ts` (now just a head start) and `sessionInit`'s await share one
   pass. *Verified:* three consecutive force-stop cold starts all restored the session — **without
   re-login**, proving the data had been stored correctly all along and only the read path was
   broken.

   *Lesson worth keeping:* any startup code reading `PersistentStore` on native must `await
   hydrate()` itself. Do not add a `provideAppInitializer` and assume it sequences.

8. ✅ **DONE — QR scanner → native plugin.** `@capacitor-mlkit/barcode-scanning` on native,
   `html5-qrcode` unchanged on web, behind the same `scanned` / `closed` outputs — the single
   consumer (`dashboard.component`) changed **zero lines**. Added `CAMERA` permission +
   `uses-feature android:required="false"` to the manifest, and a `body.barcode-scanner-active`
   rule in `styles.css` (the plugin renders the camera *natively behind* the WebView, so the page
   must go transparent; every exit path removes the class). Also handles the Google Play Services
   scanner module being absent on first use by installing it on demand.
   *Verified on device:* camera opens, decodes a real salon QR, and the app routes to the salon.
9. ✅ **DONE — Push → FCM.** `NativePushService` (`core/push/native-push.service.ts`) implements the
   FCM half; `PushService` delegates to it on native and keeps its `SwPush`/VAPID path **byte-
   identical** for web. All four consumers changed zero lines. Firebase project `hairmela-app`
   (sender `78026531104`), `google-services.json` in `android/app/`, `POST_NOTIFICATIONS` added to
   the manifest.
   **Verified end-to-end across devices:** joined a queue from the laptop (web) → the "it's your
   turn" notification arrived on the phone (native app).

   **Backend was delivered first** and drove the contract: `POST /v1/push/fcm-subscribe`
   (`{fcmToken, platform}`, upserts, guest JWTs accepted) and `POST /v1/push/fcm-unsubscribe`.
   API client regenerated — **purely additive, +6 lines, zero deletions**, no existing endpoint or
   model touched.

   **Data-only messages + local notifications.** The backend sends no `notification` block so tap
   handling stays ours. Android therefore displays nothing by itself, so `@capacitor/local-
   notifications` posts the notification — without it, notifications would only ever appear while
   the app was already open.

   ### ⚠️ The bug that made push silently fail — a 12 ms race

   First implementation fired these concurrently in `PushService`'s constructor:

   ```ts
   void this._native.init(...);     // async — binds the 'registration' listener
   void this._native.refresh(...);  // calls register() immediately
   ```

   `register()` ran **before** the listener was bound. Device logs showed `register` at `31.066`
   and the listener at `31.078` — **12 ms too late**. The token event fired into nothing, the
   promise timed out returning null, and `fcm-subscribe` was never called. No error anywhere; push
   simply never worked.

   *Fix:* the constructor awaits `init()` before `refresh()`, **and** `NativePushService` caches its
   in-flight binding promise so `enable()`/`refresh()` await the same pass regardless of call order
   — robust at the service level, not just at the one call site.

   ### Also corrected during review

   - **`permission` reported `'default'` before the async native lookup settled.** `'default'` means
     "never asked", which callers read as "safe to prompt" — so the permission prompt could flash at
     someone who had already granted or refused. Added `'unknown'` to the type, and a
     `permissionState()` **signal** so consumers re-evaluate when the real value lands (a plain
     getter was sampled once and never updated).
   - **`enable()` reported `'denied'` when registration or the server call failed.** That told users
     "you can enable this in settings" when settings could not help. Now returns `'unsupported'`
     for that case, with accurate copy in both consumers.
   - **`'android'` was hardcoded in three places** despite the DTO accepting `'android' | 'ios'`.
     Now derived from `AppPlatformService.nativePlatform`.

   **Guests get push too** — `push-prompt` never gated on auth, and the backend's `FlexAuthGuard`
   accepts guest JWTs, so this worked with no extra UI.

   **Not a bug, but it looked like one:** the prompt and account toggle appeared missing on device.
   `POST_NOTIFICATIONS` was `granted=false` with the `USER_SET` flag — the permission had already
   been declined, and both components correctly hide for a user who refused.
10. **Release build** — signing keystore, versionCode/versionName, Play Console listing. **Also:**
    point `environment.native.ts` at production — `apiBaseUrl`/`socketUrl` →
    `hairmela-backend-production.up.railway.app`, `appBaseUrl` → `https://hairmela.com`. Production's
    `CORS_ORIGIN` already carries the three native origins (verified), so no backend change is
    needed. → *verify:* a release-build device login hits production, and a generated QR resolves to
    `hairmela.com`.

### 10a. Android App Links — ✅ BUILT AND UNBLOCKED

**Done on this side:**
- `public/.well-known/assetlinks.json` with the release cert SHA-256
  (`E1:13:6E:22:...:D5:A9`) — verified copied into the build output.
- Intent filter in `AndroidManifest.xml`, `autoVerify="true"`, claiming
  **`hairmela.com`** and **`dev-hairmela.vercel.app`**, all paths.
- `DeepLinkService` — routes the tapped URL to its in-app page.

**The apex/www blocker is resolved.** `hairmela.com` was 308-redirecting to `www`, which fails
verification (Android does not follow redirects) and — because **one failing host fails the ENTIRE
filter** — would have left App Links completely inert. Vercel's domain config was flipped to make
the apex primary; `hairmela.com/.well-known/assetlinks.json` now returns **200 directly** (verified).

**`www.hairmela.com` is deliberately NOT claimed.** It now 308s to the apex, so claiming it would
reintroduce the same whole-filter failure. Users tapping a www link still reach the app: Android
follows the redirect at *navigation* time, just not at *verification* time.

**Still required: deploy the frontend.** `assetlinks.json` only exists in this repo until a Vercel
deploy publishes it. Verification fails until the live domain serves it.

**Cold-start ordering (the subtle bug this avoids).** `DeepLinkService.init()` is a
`provideAppInitializer`, and Angular runs those **in parallel** — the router is not yet live, and
`sessionInit` is concurrently deciding its own redirect. Navigating straight from `getLaunchUrl()`
would either no-op against a dead router or race `sessionInit`, with whichever landed second
silently winning. So the launch URL is captured, then applied after the **first `NavigationEnd`**,
with `replaceUrl: true` (the startup route was never somewhere the user chose to be).

**Known limitation:** the filter claims *every* path, so a link to a marketing-only route resolves
to the `**` wildcard and renders NotFoundComponent in-app, where the browser would have shown the
real page. If that proves annoying, narrow the intent filter to `/s/*` and `/g/s/*` rather than
adding path-matching logic to the service.

---

#### Original analysis (kept for context)

**Today nothing opens in the app.**

**Today nothing opens in the app.** The manifest carries only the LAUNCHER intent filter (verified),
so a shared `hairmela.com/s/:slug` link always opens the browser. Making it open the installed app
is **Android App Links**, and it belongs here rather than earlier because one required input — the
release signing certificate — does not exist until this step.

**What it needs, in order:**

1. **Intent filter** in `AndroidManifest.xml`, with `android:autoVerify="true"`, declaring the hosts
   the app claims (`https` + each host) and ideally path-scoping to the routes that make sense
   (`/s/*`, `/g/s/*`) rather than claiming the whole domain — claiming `/` would hijack every link
   to the marketing site, including `/pricing` and `/about`.
2. **`public/.well-known/assetlinks.json`**, containing the app's `applicationId`
   (`com.hairmela.app`) and the **release keystore's SHA-256 fingerprint**. Blocked until the
   keystore exists — a debug-signed fingerprint will not verify a Play-installed app.
3. **Serve it directly on every claimed host.**

**⚠️ Trap found while investigating (verified live, 2026-08-16):**
`https://hairmela.com/.well-known/assetlinks.json` returns **308 → `www.hairmela.com`**.
**Android does not follow redirects when verifying App Links** — each claimed host must answer
`200` with `Content-Type: application/json` directly. So either register **both** `hairmela.com`
and `www.hairmela.com` and make both serve the file without a redirect, or settle the apex/www
question first and make sure `appBaseUrl` matches whichever wins.

Good news on the SPA rewrite: `vercel.json`'s `"/((?!.*\\.).*)"` only rewrites paths **without a
dot**, so `.well-known/assetlinks.json` is already excluded and will be served as a real static
file. No rewrite change needed — just confirm the `Content-Type`.

**Which host does production actually use?** `environment.production.ts` takes `appBaseUrl` from the
`NG_APP_APP_BASE_URL` Vercel env var, so it is not readable from the repo. **Check it before
writing the intent filter** — printed QR posters already encode whichever host it is, and the
filter must claim that exact host.

4. **Revisit §5a at the same time.** A deep link opens the app directly at e.g. `/s/oga-boss`, but
   `sessionInit` runs on every bootstrap and may redirect based on session state before that route
   renders. §5a was closed on the basis that `atRoot` is false on any real page — a deep link is
   exactly that case and should be fine, but it must be **verified on device**, not assumed, since
   §5a's closure predates deep links existing.

**Scope note:** App Links only affect users who already have the app installed; everyone else
correctly keeps getting the website. Nudging installation from a shared link is a separate feature
(a smart app banner on the web page), not part of this.

**Verify:** with the release build installed, tapping a `hairmela.com/s/:slug` link in another app
(WhatsApp, Gmail) opens HairMela on that salon's page — not the browser — and
`adb shell pm get-app-links com.hairmela.app` reports the domains as `verified`.

---

Steps 1–6 produce a working native app — **this is now achieved.** Steps 7–9 are hardening and
parity. Step 10 is shipping.

Note that steps 1, 2 and 4 (toolchain, Capacitor install, `cap add android`) cannot affect the web
build at all — they add files and dependencies without changing any source the web build compiles.
The web-facing risk is concentrated in steps 3, 5a, 7, 8 and 9.

**Running tally of web bundle impact** (initial bundle, baseline **552.78 kB**):

| After step | Initial bundle | Note |
|---|---|---|
| Baseline | 552.78 kB | before any Capacitor work |
| Step 2 | 552.78 kB | byte-identical |
| Step 3 | 553.25 kB | +2 environment flags |
| Step 6 (first cut) | **561.41 kB** | ❌ regression — Capacitor leaked into web |
| Step 6 (fixed) | 553.82 kB | ✅ dynamic import; `@capacitor` absent from web entirely |

### Coverage map — every identified problem has an owning step

| Problem | Analysis | Owning step | Status |
|---|---|---|---|
| `--define` env substitution | §3.1 | Step 3 | ✅ Done |
| `appBaseUrl` must stay public domain | §3.2 | Step 3 | ✅ Done |
| Service worker off on native, kept on web | §3.4 (note) | Step 3 | ✅ Done |
| Back button (incl. 7 dialogs via registry) | §5 | Step 6 | ✅ Done |
| Status bar / safe areas | §5 | Step 6 | ✅ N/A — fine as-is |
| `.gitignore` for `android/` | §5 | Step 4 | ✅ Done |
| `<base href>` under WebView origin | §5 | Step 4 | ✅ Done — app loads |
| `PersistentStore` sync/async trap | §4 | Step 7 | ✅ Done |
| QR scanner / `getUserMedia` | §3.3 | Step 8 | ✅ Done |
| `session-init` cold-start heuristic | §5a | Step 5a | ✅ Closed — non-issue |
| Push → FCM + backend | §3.4 | Step 9 | ✅ Done |
| Google Fonts fetched over network | §5 | — | ⚠️ Deliberately left alone (shared `index.html`) |

No item in §3–§5 is left without an owning step.

---

## 6a. Web regression gate

Run before starting, and again after **every** step that touches `src/`. A failure here means the
step was done subtractively and must be redone as an addition.

### Recorded baseline (measured 2026-08-16, BEFORE any Capacitor install)

These are **pre-existing** and are not regressions. Do not chase them:

- **Bundle budget warning:** initial bundle 552.78 kB, exceeding the 500 kB budget by 52.78 kB.
- **Two CommonJS warnings:** `qrcode` (via `salon-share.component.ts`) and its `dijkstrajs` dep.
- **One failing test:** `src/app/app.spec.ts > App > should render title` — the untouched Angular
  CLI scaffold spec asserting `'Hello, frontend'`, which the real app never renders. Suite is
  **1 failed / 139 passed (140)**. Confirmed identical on a stashed clean tree.
- **Production build output size:** 5,576,750 bytes.
- `/v1/health` on both Railway backends returns **503** — pre-existing, unrelated to this work.

A regression is a *change* from the above, not the presence of it.

1. `ng build --configuration production` succeeds, with no new budget warnings.
2. Output still contains `ngsw-worker.js`, `ngsw.json`, and `manifest.webmanifest`.
3. `git diff` on the following shows **no behavioral change for the web path**:
   `vercel.json`, `ngsw-config.json`, `public/manifest.webmanifest`,
   `environment.production.ts`, and the `production` block of `angular.json`.
4. Served locally from a production build: app loads, service worker registers, login works,
   an existing `localStorage` session is restored without re-login.
5. Web push still subscribes and delivers (the check that matters most after step 9).
6. `npm test` — the existing Vitest suite passes, including
   `refresh.interceptor.spec.ts` and the `salon-visit` specs, which cover storage- and
   session-sensitive paths.

**Deployment ordering.** Any backend change (CORS origin, FCM token field) is additive and should
ship and be verified against the live web app *before* the native client depends on it — so the web
app proves the change is safe while native is still in development.

---

## 7. Honest assessment

Steps 1–6 are mostly mechanical; the one thing that will bite is the `--define` environment
substitution (§3.1), and it is already fully understood.

The genuine work is **push** — a second implementation behind a preserved interface *plus* a
backend change *plus* Firebase setup, and it is the feature this product most depends on. It is
also the only change with meaningful risk to existing web users, which is the argument for
sequencing it last and alone. Everything else is contained: the QR scanner has exactly one
consumer, and storage has ten but all behind a single gateway.

**On keeping the PWA intact:** this codebase is unusually well-positioned for it. Three separate
pieces of prior design work do most of the job — `PersistentStore` is already the single storage
gateway (and its docstring explicitly anticipates a Capacitor shim), `PushService` is already
consumed through a narrow interface that never leaks `SwPush`, and Angular's build configurations
already provide a clean per-target file-replacement seam. None of the three needs to be invented.
The result is that native support is additive almost everywhere, and the web build's behavior can
be held byte-identical through most of the migration.

Nothing here requires touching the existing UI components, which is precisely what dropping Ionic
buys.

**What this plan does not cover** (stated so the boundaries are explicit, not discovered later):

- **Deep links / Android App Links.** Not configured. The app launches from its icon only. Adding
  them later requires revisiting §5a at the same time — see the note there.
- **iOS.** Out of scope by decision; would additionally need a Mac with Xcode for build and signing.
- **The unused SSR dependencies** (`@angular/ssr`, `@angular/platform-server`, `express`, the
  `serve:ssr:frontend` script). Noted in §1 as pre-existing dead weight; removing them is unrelated
  to this migration and is left alone.
- **The `UpdateService` FIXME** about replacing the 10-minute background poll with a user-initiated
  update. Pre-existing, web-only, untouched by this work.
- **Play Store assets** — listing copy, screenshots, privacy policy URL, content rating. Step 10
  covers the technical release build only.

---

# 11. Where things stand, and what happens next

Everything above is history — how the app was built and why each decision was made. This section is
the forward-looking part: what is still outstanding, how to publish, and how to ship updates.

## 11.1 Remaining work

| # | Item | Blocked by | Notes |
|---|---|---|---|
| 1 | **Play Console account approval** | Google | Applied for; typically a few days. Nothing else can be published until this lands. |
| 2 | **Deploy the frontend** | — | `public/.well-known/assetlinks.json` exists only in this repo. App Links cannot verify until `hairmela.com` actually serves it. **Do this first — it needs no approval.** |
| 3 | **Test App Links on device** | (2) | See §11.4 for the verification command. |
| 4 | **Switch to the production API** | Decision | `environment.native.ts` still points at the **dev** backend. Deliberate — testers should not touch production data. Flip at launch. |
| 5 | **Store listing assets** | (1) | Icon 512×512, feature graphic 1024×500, ≥2 phone screenshots, short + full description, privacy policy URL (`/privacy` exists). |
| 6 | **Data safety + content rating** | (1) | Declare **camera** (QR scanning), **notifications**, and account data. Must match what the app actually does. |
| 7 | **Closed test (if required)** | (1) | Google requires many new personal accounts to run a closed test with **12 testers for 14 days** before production access. A two-week wall — start it the day approval lands. |

**Not doing** (deliberately, recorded so it is not rediscovered as an oversight):

- **iOS.** Would need a Mac with Xcode, an Apple Developer account, and `apple-app-site-association`
  instead of `assetlinks.json`. The code is already iOS-ready — `AppPlatformService.nativePlatform`
  returns `'ios'`, and the backend accepts `platform: 'ios'`.
- **Narrowing App Links to `/s/*`.** The filter claims every path, so marketing links open in-app
  too. Revisit only if that proves annoying in practice.

## 11.2 Before every release

Not optional, and easy to forget under time pressure:

1. **Bump `versionCode`** in `android/app/build.gradle`. Integer, must increase, **can never be
   reused** — not even for a build Google rejected. This is the single most common release mistake.
2. **Update `versionName`** if the user-facing version changed (`"1.0.0"` today).
3. **`ng build --configuration native`** — then `npx cap sync android`. **Always in that order.**
   `cap sync` copies whatever is currently in `dist/`; a stale `dist/` silently ships the wrong
   bundle (this happened once during step 4 and shipped a production-configured web build into the
   APK).
4. **Confirm which backend** `environment.native.ts` targets. Shipping a release pointed at dev is
   silent and looks fine until users see the wrong data.

## 11.3 Publishing to the Play Store

```bash
# 1. Bump versionCode in android/app/build.gradle first.

# 2. Build the web assets and sync them into the native project.
ng build --configuration native
npx cap sync android

# 3. Build the signed AAB (NOT an APK — Play requires App Bundles).
cd android && ./gradlew bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
```

Then in the Play Console:

1. **Create app** — name, default language, app-or-game, free-or-paid.
2. **Upload the `.aab`** to a track. Start with **Internal testing** — it is the fastest review and
   avoids burning a production version on a mistake.
3. **Complete the content questionnaires** — data safety, content rating, target audience, ads
   declaration. Camera and notifications must be declared.
4. **Store listing** — descriptions, icon, feature graphic, screenshots.
5. **Roll out** — internal → closed → production, as Google's requirements allow.

### Play App Signing — decide once

Google will offer to manage your signing key. If accepted, Google re-signs uploads with **their**
key, which means:

- Your `hairmela-release.jks` becomes the *upload* key, not the *app* key.
- **`assetlinks.json` must be updated** with Google's SHA-256 (shown in Console → Setup → App
  signing), or **App Links stop verifying** — the fingerprint on the domain would no longer match
  what is actually signing the installed app. The file accepts multiple fingerprints; add Google's
  alongside the existing one.

The upside is real: if the upload key is ever lost, Google can reset it. Without Play App Signing, a
lost keystore means the app can never be updated again.

**Either way: back up `hairmela-release.jks` and its password off this machine.**

## 11.4 Verifying App Links after a deploy

```bash
# The file must be live on the domain — this is what Android fetches.
curl -s https://hairmela.com/.well-known/assetlinks.json

# On the device: are the domains actually verified?
adb shell pm get-app-links com.hairmela.app
# want: hairmela.com  →  verified

# Force re-verification (Android caches failures aggressively).
adb shell pm verify-app-links --re-verify com.hairmela.app

# End-to-end: tap a link from another app (WhatsApp/Gmail) — it should open
# HairMela on the salon page, not the browser.
```

Verification is **all-or-nothing across claimed hosts**: if any declared host fails, the entire
filter fails and no link opens in the app. That is why `www.hairmela.com` is deliberately not
claimed — it 308-redirects, and Android does not follow redirects when verifying.

## 11.5 How updates work — and why it is not like the web

**This is the biggest operational difference from the PWA, and it changes how you ship.**

On the web, `UpdateService` polls for a new deploy and reloads into it — users are always on the
latest version within minutes, and a bad deploy can be rolled back instantly.

**None of that applies to the native app.** The web assets are bundled inside the APK. There is no
service worker (deliberately — see §3.4). `window.location.reload()` in the WebView reloads from
those *bundled* assets, so pull-to-refresh re-fetches **data**, never **code**.

| | Web / PWA | Android app |
|---|---|---|
| How code updates | Service worker, automatic | Play Store update |
| Time to reach users | Minutes | Hours to days (review + user action) |
| Can you force it? | Effectively yes | **No** |
| Rollback | Redeploy | Halt rollout; users already updated stay updated |
| Fixing a bad release | Deploy a fix | **New versionCode, new review** |

**What this means in practice:**

- **A bad native release is expensive.** There is no instant rollback for users who already
  installed it. Use **staged rollout** (5% → 20% → 100%) so a bad build reaches few people.
- **Old versions live indefinitely.** Some users never update. The backend must stay compatible
  with older clients, or you need a forced-update mechanism (a version check + blocking screen —
  **not currently built**).
- **Server-side changes still land instantly**, since the app talks to the same API. Anything
  fixable in the backend does not need a release.

### Two update paths

**Backend-only change** (API, notification copy, queue logic) — deploy the backend. Every client
picks it up immediately, native included. **No app release needed.**

**Frontend change** (UI, routing, a bug in Angular code):

```bash
# Bump versionCode, then:
ng build --configuration native && npx cap sync android
cd android && ./gradlew bundleRelease
# Upload the .aab, submit for review, roll out in stages.
```

Note that **the same frontend change also needs a Vercel deploy** for web users. Native and web ship
from one codebase but on two independent release cadences — web is instant, native is days. Expect
them to be out of sync, and keep the backend compatible with both.
