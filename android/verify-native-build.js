#!/usr/bin/env node
/**
 * Fails the Android build when the bundled web assets were NOT produced by
 * `ng build --configuration native`.
 *
 * WHY THIS EXISTS: `--configuration production` also produces a working-looking
 * bundle, and `npx cap sync` copies whatever is in dist/ without inspecting it,
 * so the mistake is invisible until the APK is on a device. Build 22 shipped
 * that way: environment.production.ts sets `native: false`, which silently
 * disables the hardware back button, native push, deep links and Capacitor
 * Preferences storage, and renders the marketing nav inside the app. Nothing
 * crashed — it just quietly stopped being a native app.
 *
 * The two configurations differ in angular.json by exactly two things, and this
 * checks both:
 *
 *   1. environment file — native hardcodes the API host, production reads it
 *      from NG_APP_API_BASE_URL. So the literal host appears in the bundle only
 *      in a native build.
 *   2. serviceWorker — set only in production, which emits ngsw.json. A service
 *      worker has no business inside a Capacitor WebView that already serves
 *      its own assets.
 *
 * Checking the SHIPPED ASSETS rather than the command line is deliberate: it
 * catches a stale dist/ from an earlier prod build just as well as a mistyped
 * flag, which a wrapper script around `ng build` would not.
 */
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, 'app/src/main/assets/public');
// Must match environment.native.ts's apiBaseUrl host. If that file's host ever
// changes, this string has to change with it — the mismatch fails loudly rather
// than passing silently, which is the intended failure direction.
const NATIVE_API_HOST = 'hairmela-backend-production.up.railway.app';

function fail(problem, detail) {
  console.error('\n  ✘ Web assets were not built for native.\n');
  console.error(`    ${problem}`);
  if (detail) console.error(`    ${detail}`);
  console.error('\n    Rebuild with the native configuration:\n');
  console.error('      npx ng build --configuration native');
  console.error('      npx cap sync android\n');
  process.exit(1);
}

if (!fs.existsSync(ASSETS)) {
  fail('No web assets found at app/src/main/assets/public.', 'Run `npx cap sync android` after building.');
}

// 1. A service worker manifest is emitted only by the production config.
if (fs.existsSync(path.join(ASSETS, 'ngsw.json'))) {
  fail(
    'Found ngsw.json — these assets came from `--configuration production`.',
    'The native config omits the service worker on purpose.',
  );
}

// 2. The native environment hardcodes the API host; production substitutes an
//    env var, so the literal is absent there. Checked against the entry bundle
//    rather than every chunk — that is where the environment object lands.
const bundles = fs.readdirSync(ASSETS).filter((f) => f.startsWith('main-') && f.endsWith('.js'));
if (bundles.length === 0) {
  fail('No main-*.js bundle in the synced assets.', 'The build output looks incomplete.');
}

const hasNativeHost = bundles.some((f) =>
  fs.readFileSync(path.join(ASSETS, f), 'utf8').includes(NATIVE_API_HOST),
);
if (!hasNativeHost) {
  fail(
    `The bundle does not contain ${NATIVE_API_HOST}.`,
    'environment.native.ts hardcodes that host; its absence means another environment was used.',
  );
}

console.log('  ✔ Web assets built for native.');
