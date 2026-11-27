import type { CapacitorConfig } from '@capacitor/cli';

// Plaibook Live for iPhone and iPad: the site's own build (ui/dist-native, made by `npm run cap:sync`) inside a native
// shell. The app ships its pages and calls https://www.plaibook.live for data; never commit a `server.url` here
// (a wrapper around the live site is what App Review rejects, and a deploy could then break installed apps).
const config: CapacitorConfig = {
  appId: 'live.plaibook.app',
  appName: 'Plaibook Live',
  webDir: 'dist-native',
  // The app draws edge to edge and handles the notch and home indicator in CSS (env(safe-area-inset-*)).
  ios: { contentInset: 'never', backgroundColor: '#0A1628' },
  plugins: {
    SplashScreen: { launchShowDuration: 600, backgroundColor: '#0A1628', showSpinner: false },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'banner'] },
  },
};

export default config;
