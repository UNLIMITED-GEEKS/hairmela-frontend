# iOS release setup

The committed `ios/` project and `codemagic.yaml` build HairMela with the native Angular environment, sign `com.hairmela.app`, and upload the resulting IPA to TestFlight. The project uses CocoaPods because the ML Kit barcode scanner does not support Swift Package Manager.

## One-time Apple setup

1. Join the Apple Developer Program and create the App ID `com.hairmela.app`.
2. Enable Push Notifications and Associated Domains for that App ID.
3. Create the HairMela app record in App Store Connect with the same bundle ID.
4. Create an App Store Connect API key with App Manager access.
5. Add that key to Codemagic under Team integrations > Developer Portal with the exact name `hairmela-app-store-connect`.
6. Let Codemagic create or fetch an Apple Distribution certificate and App Store provisioning profile for `com.hairmela.app`.

The first Codemagic run can then use the `HairMela iOS App Store` workflow. Successful builds are uploaded to TestFlight, but are not automatically submitted to App Review.

## Universal links

The app declares these Associated Domains:

- `applinks:hairmela.com`
- `applinks:dev-hairmela.vercel.app`

Each host must serve an `apple-app-site-association` file containing the Apple Team ID and `com.hairmela.app` before universal links open the app. The existing `hairmela://` custom scheme works independently of that file.

## Push notifications

The iOS project registers its APNs device token with the backend. After creating the Apple Developer account, create an APNs Auth Key and set these backend deployment variables:

- `APNS_KEY_ID`: the key ID shown by Apple.
- `APNS_TEAM_ID`: the Apple Developer Team ID.
- `APNS_PRIVATE_KEY_BASE64`: the downloaded `.p8` file encoded with `base64 -w 0 AuthKey_XXXXXXXXXX.p8`.
- `APNS_BUNDLE_ID`: `com.hairmela.app` (this is already the backend default).
- `APNS_ENVIRONMENT`: `production` for TestFlight and App Store builds; use `sandbox` only for development-signed builds.

The existing Android Firebase configuration and `FCM_SERVICE_ACCOUNT_JSON` remain unchanged.

## Local commands

These require macOS with Xcode and CocoaPods:

```bash
npm ci
npx ng build --configuration native
npx cap sync ios
cd ios/App
pod install
open App.xcworkspace
```
