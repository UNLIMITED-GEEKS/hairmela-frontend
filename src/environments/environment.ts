export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:3000',
  socketUrl: 'http://localhost:3000',
  appBaseUrl: 'http://localhost:4200',
  cloudinaryCloudName: 'dievyx0ia',
  // Unsigned upload preset — create in Cloudinary: Settings → Upload →
  // Upload presets → Add, signing mode "Unsigned". Restrict it there
  // (allowed formats, max file size, folder); it is public in the bundle.
  cloudinaryUploadPreset: 'hairmela',
  // Web builds keep the Angular service worker. Actual registration is still
  // gated on !isDevMode() in app.config.ts, so this stays a no-op under
  // `ng serve` exactly as before — the flag exists so the native build can opt
  // out without touching the web path.
  serviceWorker: true,
  // Build-time flag for "this bundle runs inside Capacitor". Used to guard
  // dynamic import()s of native-only packages so they never enter a web
  // bundle — a runtime Capacitor.isNativePlatform() check cannot do that,
  // since it requires loading the very module we want to keep out.
  native: false,
};
