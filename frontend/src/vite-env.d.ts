/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin for the mobile app build, e.g. https://avistay.com. Empty on the website. */
  readonly VITE_API_URL?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  readonly VITE_CLOUDINARY_CLOUD?: string;
  readonly VITE_CLOUDINARY_PRESET?: string;
}
