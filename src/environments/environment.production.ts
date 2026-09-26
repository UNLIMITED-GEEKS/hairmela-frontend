// These three are substituted at build time via `ng build --define`, driven
// by env vars set in each Vercel project's own dashboard (Settings →
// Environment Variables) — NOT hardcoded here, since this one file is shared
// by every production build regardless of which Vercel project/branch is
// building (see angular.json's fileReplacements, which always swaps this
// file in for the "production" configuration).
//
// declare const, not import — `--define` replaces the bare identifier
// textually at compile time; there is no runtime value or module behind it,
// so importing it would fail.
//
// VERIFIED (do not assume otherwise): if a define is missing, `ng build`
// does NOT fail — it leaves the bare identifier in the compiled bundle as an
// unresolved global reference, and the build succeeds. The failure only
// surfaces at RUNTIME, the first time any code reads environment.apiBaseUrl
// (or the other two), as `ReferenceError: NG_APP_API_BASE_URL is not
// defined`. Confirmed by building with `ng build --configuration
// production` and no --define flags, then grepping the output bundle for
// the bare identifier.
//
// Because ng build itself won't catch a missing define, the Vercel Build
// Command (each project's Settings → Build & Development) MUST check these
// env vars are set and fail the command itself before invoking ng build.
// VERIFIED end-to-end (built successfully, grepped the output bundle for the
// real URL and confirmed no leftover unresolved identifier):
//
//   test -n "$API_BASE_URL" && test -n "$SOCKET_URL" && test -n "$APP_BASE_URL" && \
//   ng build --configuration production \
//     --define "NG_APP_API_BASE_URL=\"$API_BASE_URL\"" \
//     --define "NG_APP_SOCKET_URL=\"$SOCKET_URL\"" \
//     --define "NG_APP_APP_BASE_URL=\"$APP_BASE_URL\""
//
// Note the escaped double quotes around each $VAR, not single quotes — a
// single-quoted string inside a double-quoted shell argument does NOT
// interpolate the variable (confirmed: this was wrong in an earlier draft of
// this comment and silently produced the literal string "$API_BASE_URL" in
// the bundle instead of its value).
//
// This guard is the ONLY thing standing between a misconfigured Vercel
// project and a deployed bundle that throws on first load.
declare const NG_APP_API_BASE_URL: string;
declare const NG_APP_SOCKET_URL: string;
declare const NG_APP_APP_BASE_URL: string;

export const environment = {
  production: true,
  apiBaseUrl: NG_APP_API_BASE_URL,
  socketUrl: NG_APP_SOCKET_URL,
  appBaseUrl: NG_APP_APP_BASE_URL,
  cloudinaryCloudName: 'dievyx0ia',
  // Unsigned upload preset — see environment.ts. Hardcoded like the cloud
  // name (both are public values, not secrets), so it needs no --define.
  cloudinaryUploadPreset: 'hairmela',
  // Production web keeps the Angular service worker exactly as before. Only
  // the Capacitor native build (environment.native.ts) opts out.
  serviceWorker: true,
  // See environment.ts — false for every web build.
  native: false,
  payloadEncryptionMode: 'required' as const,
};
