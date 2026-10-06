import type { CapacitorConfig } from '@capacitor/cli';

/*
  Sky Cars Admin wrapper.
  The APK is only a secure shell: it loads the real admin web app over HTTPS.
  No credentials are stored in the app and the admin login is never bypassed.
*/
const config: CapacitorConfig = {
  appId: 'com.skyshcars.admin',
  appName: 'Sky Cars Admin',
  webDir: 'www',
  server: {
    url: 'https://skyshcars.com/admin',
    hostname: 'skyshcars.com',
    androidScheme: 'https',
    cleartext: false, // HTTPS only
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
