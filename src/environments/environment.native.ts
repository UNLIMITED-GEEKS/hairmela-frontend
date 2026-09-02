// Environment for the CAPACITOR NATIVE (Android) build only.
//
// Swapped in by the "native" configuration in angular.json (fileReplacements).
// The web builds are untouched: `development` uses environment.ts and
// `production` uses environment.production.ts exactly as before.
//
// WHY THE URLS ARE HARDCODED HERE (and not `--define`d like production):
// environment.production.ts reads its three URLs from bare identifiers that
// `ng build --define` substitutes at compile time, driven by env vars set in
// the Vercel dashboard. There is no Vercel in this build path — a native build
// is produced locally and packaged into an APK — so there is nothing to supply
// those defines. Building native against the production configuration would
// leave the bare identifiers unresolved in the bundle, and (per that file's
// own verified notes) `ng build` does NOT fail on a missing define: it throws
// at RUNTIME on the first API call with "ReferenceError: NG_APP_API_BASE_URL
// is not defined". Hardcoding here is the correct trade — these are public,
// non-secret URLs, and the app must be self-contained inside the APK.
//
// TARGETS PRODUCTION. This was the development backend while the native app
// was unreleased; step 10 of capacitor-android-migration-plan.md switched it,
// and the Railway host below is the same one the website uses. The note is
// kept because the hostname alone does not prove which environment it is —
// "production" there is the Railway service name, not evidence.
export const environment = {
  production: true,

  // Both point at the same Railway host — verified live: /v1 returns 200 and
  // the Socket.IO handshake on that host returns a session id.
  apiBaseUrl: 'https://hairmela-backend-production.up.railway.app',
  socketUrl: 'https://hairmela-backend-production.up.railway.app',

  // NOT the WebView origin. Under Capacitor the app runs from
  // https://localhost, but this value is used to build links that OTHER people
  // open — copy-to-clipboard share links and, critically, the QR code payload
  // printed on physical salon posters (salon-landing.component.ts). Pointing it
  // at the WebView origin would encode "https://localhost/..." onto a printed
  // poster. It must always be a real, publicly reachable website.
  // The apex, NOT www: www 308-redirects here, and the App Links intent filter
  // claims the apex — so QR payloads and share links must use the host that is
  // actually verified, with no redirect hop.
  appBaseUrl: 'https://hairmela.com',

  cloudinaryCloudName: 'dievyx0ia',
  cloudinaryUploadPreset: 'hairmela',

  // No Angular service worker in the native build. The APK already ships its
  // assets locally, so a caching SW adds a second stale-asset layer and a
  // confusing update path, and UpdateService's auto-reload-on-deploy is
  // meaningless in an installed app. The "native" configuration also omits
  // angular.json's `serviceWorker` option, so ngsw-worker.js is never even
  // emitted — this flag stops provideServiceWorker from trying to register a
  // file that does not exist (isDevMode() is false in an optimized build, so
  // it would otherwise attempt registration).
  serviceWorker: false,

  // The one build where this is true. Guards dynamic import()s of Capacitor
  // plugin packages, keeping them out of the web bundles entirely rather than
  // shipping them to web users behind a runtime check that never passes.
  native: true,
};
