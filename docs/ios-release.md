# HairMela iOS release plan

This guide takes HairMela from an approved Apple Developer membership to a signed App Store release using Codemagic. The build starts from a Linux terminal; Codemagic supplies macOS and Xcode, signs the IPA, uploads it, submits it for review, and releases it automatically after Apple approves it.

## Important ownership note

The Apple Developer account that publishes HairMela controls the App Store listing. For an Individual membership:

- The seller name is the account holder's legal name, not HairMela.
- The account holder remains responsible for agreements and account-level actions.
- Never share the account holder's Apple Account password. Use invitations and API keys.
- If HairMela later gets an Organization membership, request an app transfer or ask Apple about converting the membership.

Continue only if publishing under the account holder's legal name is acceptable.

## What is already configured

The repository already has:

- Capacitor iOS under `ios/`.
- Bundle identifier `com.hairmela.app`.
- Native configuration from `src/environments/environment.native.ts`.
- The `ios-app-store` workflow in `codemagic.yaml`.
- Workspace `ios/App/App.xcworkspace` and scheme `App`.
- iOS 15 deployment target.
- APNs registration and backend subscription support.

The workflow currently uploads to TestFlight without submitting to App Review:

```yaml
publishing:
  app_store_connect:
    auth: integration
    submit_to_testflight: true
    submit_to_app_store: false
```

Keep this for the first signed build and TestFlight validation.

## Phase 1: Apple account access

### 1. Accept Apple agreements

The Account Holder must sign in to:

- <https://developer.apple.com/account/>
- <https://appstoreconnect.apple.com/>

Accept every pending Developer Program and App Store Connect agreement.

### 2. Invite the HairMela maintainer

Open:

`App Store Connect -> Users and Access -> People -> +`

Invite the maintainer's Apple Account with **App Manager** access. The Account Holder must still perform restricted actions such as accepting agreements and initially requesting API access.

## Phase 2: Register HairMela

### 3. Create the App ID

Open:

`Apple Developer -> Certificates, Identifiers & Profiles -> Identifiers -> + -> App IDs -> App`

Use:

| Field          | Value              |
| -------------- | ------------------ |
| Description    | HairMela           |
| Bundle ID type | Explicit           |
| Bundle ID      | `com.hairmela.app` |

Enable:

- Push Notifications
- Associated Domains

The bundle identifier must exactly match the repository.

### 4. Create the App Store record

Open:

`App Store Connect -> Apps -> + -> New App`

Use:

| Field            | Value                                      |
| ---------------- | ------------------------------------------ |
| Platform         | iOS                                        |
| Name             | HairMela                                   |
| Primary language | English                                    |
| Bundle ID        | `com.hairmela.app`                         |
| SKU              | `hairmela-ios`                             |
| User access      | Full Access unless restrictions are needed |

`HairMela iOS App Store` in Codemagic is only an internal workflow name. Customers see **HairMela**.

## Phase 3: Signing and Codemagic

### 5. Create an App Store Connect API key

The Account Holder should open:

`App Store Connect -> Users and Access -> Integrations -> App Store Connect API`

If access is unavailable, the Account Holder must request it first. Once enabled:

1. Open **Team Keys**.
2. Generate a key named `Codemagic`.
3. Give it the **App Manager** role.
4. Download the `.p8` file immediately; Apple allows only one download.
5. Record the Key ID and Issuer ID.

Store the key securely. Never commit it, paste it into chat, or place it in an Angular environment file.

### 6. Connect Apple to Codemagic

Open:

`Codemagic -> Team settings -> Integrations -> Developer Portal -> Connect`

Enter:

| Field            | Value                        |
| ---------------- | ---------------------------- |
| Integration name | `hairmela-app-store-connect` |
| Issuer ID        | Value from Apple             |
| Key ID           | Value from Apple             |
| API private key  | Downloaded `.p8`             |

The integration name must exactly match:

```yaml
integrations:
  app_store_connect: hairmela-app-store-connect
```

### 7. Allow Codemagic to sign the app

The workflow already requests:

```yaml
environment:
  ios_signing:
    distribution_type: app_store
    bundle_identifier: com.hairmela.app
```

Codemagic will fetch or create the Apple Distribution certificate and App Store provisioning profile. If it requests `CERTIFICATE_PRIVATE_KEY`, generate a dedicated 2048-bit RSA signing key using Codemagic's automatic iOS-signing instructions and store it as a protected Codemagic variable. Never commit that key.

## Phase 4: Push notifications

### 8. Create the APNs key

Open:

`Apple Developer -> Certificates, Identifiers & Profiles -> Keys -> +`

1. Name it `HairMela Push`.
2. Enable Apple Push Notifications service.
3. Register and download the `.p8` file immediately.
4. Record the key ID and Apple Team ID.

Configure the backend deployment:

```text
APNS_KEY_ID=<APNs key ID>
APNS_TEAM_ID=<Apple Team ID>
APNS_PRIVATE_KEY_BASE64=<base64 encoded p8>
APNS_BUNDLE_ID=com.hairmela.app
APNS_ENVIRONMENT=production
```

Encode the key on Linux with:

```bash
base64 -w 0 AuthKey_XXXXXXXXXX.p8
```

Use `production` for TestFlight and App Store. Android FCM remains unchanged.

## Phase 5: Universal links

The app declares:

- `applinks:hairmela.com`
- `applinks:dev-hairmela.vercel.app`

Each host must serve an `apple-app-site-association` file containing:

```text
YX33SDQLDJ.com.hairmela.app
```

The shared deployment file is `public/.well-known/apple-app-site-association`, and
`vercel.json` serves it as `application/json`. After deploying both hosts, verify:

```bash
curl -i https://hairmela.com/.well-known/apple-app-site-association
curl -i https://dev-hairmela.vercel.app/.well-known/apple-app-site-association
```

Both responses must be `200`, must not redirect, and must contain
`YX33SDQLDJ.com.hairmela.app`. The `hairmela://` custom scheme works independently.

## Phase 6: App Store information

Complete the following before automatic App Review submission:

- Description, subtitle, and keywords
- Primary category
- Support URL and privacy-policy URL
- App Privacy questionnaire
- Age rating
- Copyright
- Required iPhone screenshots
- Review contact details and review notes
- Demo credentials if authentication is needed
- Pricing and availability
- Export-compliance questions

Explain queue notifications, location, QR scanning, guest access, appointments, and subscription behavior where relevant. Missing metadata can make Codemagic upload successfully but fail during review submission.

## Phase 7: Commit the release

```bash
cd /home/ikwuh-jeffery/UG/HairMela/frontend
git status
git diff --check
git add <reviewed-release-files>
git commit -m "Prepare iOS release"
git push origin prod
```

Review files before staging. Do not blindly use `git add .` when unrelated changes exist.

## Phase 8: Trigger Codemagic from Linux

### 9. Create a Codemagic API token

Create an API token in Codemagic account settings. Find the application ID in the Codemagic application URL or settings.

```bash
export HAIRMELA_CODEMAGIC_TOKEN='your-codemagic-api-token'
export HAIRMELA_CODEMAGIC_APP_ID='your-codemagic-application-id'
```

Keep these values out of Git.

### 10. Start the workflow

```bash
curl \
  -H "Content-Type: application/json" \
  -H "x-auth-token: $HAIRMELA_CODEMAGIC_TOKEN" \
  --data "{\
    \"appId\": \"$HAIRMELA_CODEMAGIC_APP_ID\",\
    \"workflowId\": \"ios-app-store\",\
    \"branch\": \"prod\"\
  }" \
  -X POST https://api.codemagic.io/builds
```

A successful request returns a build ID. Codemagic then:

1. Clones `prod`.
2. Runs `npm ci`.
3. Builds Angular with the native configuration.
4. Synchronizes Capacitor iOS.
5. Applies the signing profile.
6. Assigns a unique build number.
7. Builds and signs the IPA.
8. Uploads it to App Store Connect.
9. Sends it to TestFlight under the initial configuration.

## Phase 9: TestFlight validation

Wait for Apple to process the build, then install it on a real iPhone and verify:

- Cold launch and splash screen
- Registration, login, logout, and password autofill
- API requests and queue socket updates
- User and guest queue/appointment flows
- Push permission and token registration
- Push in foreground, background, and after swiping the app away
- Notification deep links
- Camera and QR scanning
- Location and nearby search
- Media uploads
- Card and bank-transfer billing
- Universal links and custom-scheme fallback
- Light and dark themes
- Offline and restored-connection banner

An app explicitly force-stopped by the operating system may not receive push until reopened. Fix TestFlight problems and upload another build before public submission.

## Phase 10: Automatic App Store release

After TestFlight passes and all metadata is complete, change `codemagic.yaml` to:

```yaml
publishing:
  app_store_connect:
    auth: integration
    submit_to_testflight: true
    submit_to_app_store: true
    release_type: AFTER_APPROVAL
```

`AFTER_APPROVAL` means:

1. Codemagic uploads the signed IPA.
2. Codemagic submits it to App Review.
3. Apple reviews it.
4. Apple automatically releases it publicly after approval.

Do not use `MANUAL` when automatic release is intended. Use `SCHEDULED` only for a chosen future release time.

Commit and push the workflow change, then run the same terminal `curl` command.

## Phase 11: Monitor release

Monitor both Codemagic logs and App Store Connect. If Apple rejects the submission:

1. Read the exact review message.
2. Reply if clarification is sufficient.
3. Change only the required code or metadata.
4. Upload a new build if the binary changed.
5. Resubmit after every issue is resolved.

## Checklist

- [ ] Individual seller name and ownership are acceptable
- [ ] Apple agreements accepted
- [ ] Maintainer invited with App Manager access
- [ ] App ID `com.hairmela.app` created
- [ ] Push Notifications and Associated Domains enabled
- [ ] HairMela App Store record created
- [ ] App Store Connect API access enabled
- [ ] App Manager API key securely stored
- [ ] Codemagic integration named `hairmela-app-store-connect`
- [ ] Distribution certificate and provisioning profile available
- [ ] APNs backend production secrets configured
- [ ] App Store metadata and screenshots complete
- [ ] First build uploaded to TestFlight
- [ ] TestFlight build tested on a real iPhone
- [ ] Background push and deep links verified
- [ ] Universal links verified
- [ ] `submit_to_app_store: true` enabled
- [ ] `release_type: AFTER_APPROVAL` enabled
- [ ] Production build triggered from the terminal
- [ ] Review monitored until public release

## Official references

- Apple app records: <https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app>
- Apple API keys: <https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api>
- Apple publishing: <https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/overview-of-publishing-your-app-on-the-app-store>
- Apple TestFlight: <https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview>
- Codemagic App Store publishing: <https://docs.codemagic.io/yaml-publishing/app-store-connect/>
- Codemagic Builds API: <https://docs.codemagic.io/rest-api/builds/>
