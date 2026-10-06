import { Capacitor } from "@capacitor/core";

/** True inside the iOS/Android app, false on the website. */
export const isNativeApp = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform() as "ios" | "android" | "web";
