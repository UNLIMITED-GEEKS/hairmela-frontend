import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hairmela.app',
  appName: 'HairMela',
  webDir: 'dist/frontend/browser',
  plugins: {
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ['apple.com'],
    },
  },
};

export default config;
