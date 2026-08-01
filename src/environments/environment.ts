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
};
