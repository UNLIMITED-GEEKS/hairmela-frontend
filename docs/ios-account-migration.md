# iOS account migration: friend's Apple account → own account

Goal: a second, independent HairMela iOS setup on our own Apple Developer account, so we can switch to it if Apple rejects the submission on the friend's account.

| | Friend's account (existing) | Our account (new) |
| --- | --- | --- |
| Bundle ID | `com.hairmela.app` | `com.unlimitedgeeks.hairmela` |
| Team ID | `YX33SDQLDJ` | `86LSMHFG6U` |
| App Store ID | `6816222315` | `6825793638` |
| Codemagic integration | `hairmela-app-store-connect` | `unlimitedgeeks-app-store-connect` |
| Membership | Individual | Individual |

Android stays on `com.hairmela.app` (live on Google Play). Do not change `android/`, `assetlinks.json`, or the Play Store links.

## Done (frontend repo, uncommitted until reviewed)

- [x] Xcode bundle ID changed to `com.unlimitedgeeks.hairmela` (`ios/App/App.xcodeproj/project.pbxproj`, Debug + Release)
- [x] `codemagic.yaml`: new `bundle_identifier` and integration name `unlimitedgeeks-app-store-connect`
- [x] `public/.well-known/apple-app-site-association`: added `86LSMHFG6U.com.unlimitedgeeks.hairmela`, kept the old entry so both apps claim universal links
- [x] App Store ID updated to `6825793638` in `mobile-top-bar.component.ts`, `page-header.component.ts`, `app-update.service.ts`
- [x] `docs/ios-release.md` updated to the new IDs, with Sign in with Apple added to the App ID capabilities

## Apple Developer / App Store Connect (our account)

- [x] Accept all pending agreements (developer.apple.com and appstoreconnect.apple.com)
- [x] Create the App ID `com.unlimitedgeeks.hairmela` with **Push Notifications**, **Associated Domains** and **Sign in with Apple**
- [x] Create the App Store Connect app record (Apple ID `6825793638`)
- [ ] Confirm the app name is accepted (names are unique; "HairMela" may be taken by the friend's app)
- [ ] Create an App Store Connect API key (name `Codemagic`, role App Manager); download the `.p8` once, record Key ID and Issuer ID
- [ ] Create an APNs key (`HairMela Push`, Apple Push Notifications service enabled); download the `.p8` once, record Key ID
- [ ] Complete App Store metadata: description, keywords, category, support and privacy URLs, App Privacy, age rating, screenshots, pricing, export compliance
- [ ] Add review notes and demo credentials. Mention account-free salon browsing (Guideline 5.1.1(v)) and answer the subscription/business-model questions
- [ ] Add the Individual seller name acknowledgement (seller = account holder's legal name)

## Codemagic

- [ ] Add a new Developer Portal integration named exactly `unlimitedgeeks-app-store-connect` (Issuer ID, Key ID, `.p8`)
- [ ] Let Codemagic generate the Apple Distribution certificate and App Store profile for `com.unlimitedgeeks.hairmela` (add `CERTIFICATE_PRIVATE_KEY` as a protected variable if asked)
- [ ] Confirm the build branch has these changes (`prod` per `docs/ios-release.md`; changes are currently on `dev`)
- [ ] After the first build, check `ios/App/App/capacitor.config.json` did not overwrite the bundle ID (`capacitor.config.ts` `appId` is shared with Android and is intentionally unchanged)
- [ ] Keep `submit_to_app_store: false` for the first build; validate on TestFlight before enabling automatic submission

## Firebase console

- [x] Add an **iOS app** to the existing Firebase project with bundle ID `com.unlimitedgeeks.hairmela`
- [x] Download the new `GoogleService-Info.plist` and replace `ios/App/App/GoogleService-Info.plist` (tracked in git)
- [x] Authentication → Sign-in method → **Apple**: confirm the provider is enabled and accepts the new bundle ID
- [ ] If iOS push goes through Firebase Messaging anywhere, upload the new APNs key (the backend plan sends APNs directly, so this is probably not needed; verify)

## Google Cloud console (Google Sign-In)

- [x] iOS OAuth client created by hand in Google Cloud for the new bundle ID (Firebase's plist has no CLIENT_ID because Google isn't an enabled Firebase provider): `78026531104-pgt79e1a5f7vhb742hi0rt07209ibrk9.apps.googleusercontent.com`
- [ ] OAuth consent screen: no change expected, but check the app is published/in production if external users sign in
- [x] Copy the new `CLIENT_ID` and `REVERSED_CLIENT_ID` from the new plist

## Frontend (blocked on the Firebase plist)

- [x] `ios/App/App/Info.plist`: replace `GIDClientID` with the new `CLIENT_ID`
- [x] `ios/App/App/Info.plist`: replace the `com.googleusercontent.apps.…` URL scheme with the new `REVERSED_CLIENT_ID`
- [ ] Run `npx ng build --configuration native` and `npx cap sync ios`; confirm it passes
- [ ] Deploy the web app so both hosts serve the updated AASA, then verify:
  - [ ] `curl -i https://hairmela.com/.well-known/apple-app-site-association` → 200, no redirect, contains `86LSMHFG6U.com.unlimitedgeeks.hairmela`
  - [ ] `curl -i https://dev-hairmela.vercel.app/.well-known/apple-app-site-association` → same
- [ ] Commit and push the reviewed files (do not use `git add .`)
- [ ] Update `docs/ios-release.md` ownership note once the final account is decided

## Backend (not started; frontend first)

- [ ] APNs production config for the new app: `APNS_KEY_ID`, `APNS_TEAM_ID=86LSMHFG6U`, `APNS_PRIVATE_KEY_BASE64`, `APNS_BUNDLE_ID=com.unlimitedgeeks.hairmela`
- [ ] These are single values today. Decide whether to support both apps at once (per-bundle APNs config) or only switch over when we pick one
- [ ] Check any **Apple identity-token audience** validation: it must accept `com.unlimitedgeeks.hairmela` as well as `com.hairmela.app`
- [ ] Check any **Google ID-token audience** allowlist: it must accept the new iOS OAuth client ID
- [ ] Confirm push tokens registered from the new app are routed with the right APNs credentials

## In-app purchase (iOS, via RevenueCat, monthly only)

Frontend is built: `IapService`, `IapPaymentUiComponent`, billing page wiring, `billingMode` ('web' | 'iap' | 'none'). Android stays hidden. It cannot be exercised until the items below exist.

- [x] Frontend: RevenueCat Capacitor plugin, StoreKit price display, Subscribe / Restore purchases / Manage subscription, auto-renew disclosure with Terms and Privacy links
- [x] App Store Connect → Subscriptions: create a subscription group (e.g. "HairMela Plans") with three auto-renewing monthly products. Product IDs must be exactly `hairmela_standard_monthly`, `hairmela_pro_monthly`, `hairmela_scale_monthly` (change `IAP_PRODUCT_TIER` in `iap.service.ts` if you use different IDs)
- [x] Set price, display name and description for each product (prices ₦3,500 / ₦6,900 / ₦12,900). Review screenshot generated from the real iOS component (1170×2532); optionally retake on a real iPhone from TestFlight
- [ ] Agreements, Tax and Banking → **Paid Apps Agreement** accepted, bank and tax info filled in (products will not load without it)
- [x] Create a RevenueCat project; add the iOS app with bundle ID `com.unlimitedgeeks.hairmela`
- [x] App Store Connect → Users and Access → Integrations → **In-App Purchase** key: generate and upload the `.p8` to RevenueCat (this is a different key from the API key used by Codemagic)
- [x] App Store Connect → App Information → App Store Server Notifications: RevenueCat's URL set for Production and Sandbox (Version 2)
- [x] RevenueCat: three App Store products, entitlements `hairmela_standard` / `hairmela_pro` / `hairmela_scale`, and the `default` offering with the App Store products in each package. Webhook payloads report these entitlement identifiers, so the backend maps them to tiers 1 / 2 / 3
- [x] Put the RevenueCat **public iOS SDK key** (`appl_…`) in `revenueCatIosApiKey` in `src/environments/environment.native.ts`. Until it is set, the app shows "Couldn't load plans"
- [ ] Add the three subscriptions to the app version for review (App Store Connect → the version → In-App Purchases and Subscriptions)
- [ ] Add a sandbox tester (Users and Access → Sandbox) and test buy, cancel-out of the Apple sheet, restore, and "Manage subscription"
- [ ] Backend: RevenueCat webhook → set the org's tier from the product (`appUserID` is the org id). Until this exists a purchase takes payment but the plan does not change
- [ ] Backend: decide what happens when an org is already on a web-card plan and buys on iOS (no double-billing guard exists on the frontend)
- [ ] Review notes: state that subscriptions are sold through in-app purchase and give sandbox/demo steps

## Testing (TestFlight, real iPhone)

- [ ] Cold launch, registration, login, logout
- [ ] Sign in with Apple
- [ ] Sign in with Google
- [ ] Guest browsing without an account (the Apple rejection fix)
- [ ] Push: foreground, background, after swipe-away; notification deep links
- [ ] Universal links and the `hairmela://` fallback
- [ ] "Share app" and "update available" open the new App Store listing (`id6825793638`)
- [ ] Camera/QR, location, media upload, billing

## Cutover decision

- [ ] Friend's submission approved → keep it, or transfer the app to our account later
- [ ] Friend's submission rejected → submit the build on our account
- [ ] If we switch for good: remove the old AASA entry, retire the old APNs config, and update the Play Store / App Store links as needed
