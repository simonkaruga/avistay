/**
 * Mobile-app login tokens, kept in the iOS Keychain / Android Keystore.
 * The website never uses this — it relies on httpOnly cookies.
 */
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

const ACCESS = "sn_access";
const REFRESH = "sn_refresh";

let accessCache: string | null | undefined;   // avoid a Keychain read per request

export async function getAccessToken(): Promise<string | null> {
  if (accessCache === undefined) accessCache = await SecureStorage.getItem(ACCESS).catch(() => null);
  return accessCache;
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStorage.getItem(REFRESH).catch(() => null);
}

export async function saveTokens(access: string, refresh: string): Promise<void> {
  accessCache = access;
  await Promise.all([SecureStorage.setItem(ACCESS, access), SecureStorage.setItem(REFRESH, refresh)]);
}

export async function clearTokens(): Promise<void> {
  accessCache = null;
  await Promise.all([SecureStorage.removeItem(ACCESS), SecureStorage.removeItem(REFRESH)]).catch(() => {});
}
