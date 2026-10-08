import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native app shell for Google Play and the App Store.
 * appId is permanent once published — never change it.
 * Web build for the app: `npm run build:app` (points the API at VITE_API_URL).
 */
const config: CapacitorConfig = {
  appId: "com.naivastay.app",
  appName: "NaivaStay",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  ios: {
    contentInset: "never",          // we handle notches with CSS safe-area insets
    scheme: "NaivaStay",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: false,        // hidden by NativeShell once the app has rendered
      backgroundColor: "#1e4a22",
      showSpinner: false,
    },
    Keyboard: {
      resizeOnFullScreen: true,
    },
  },
};

export default config;
