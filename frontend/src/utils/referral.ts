/**
 * Agent referral codes. A visitor who arrives on any link with ?ref=CODE is
 * credited to that agent if they book within 30 days on this device.
 */
const KEY = "naivastay.ref";
const DAYS = 30;

export function captureReferral(search: string = window.location.search): void {
  const code = new URLSearchParams(search).get("ref")?.trim().toUpperCase();
  if (!code || !/^[A-Z0-9]{4,12}$/.test(code)) return;
  try { localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() })); } catch { /* private mode */ }
}

export function currentReferral(): string | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const { code, at } = JSON.parse(raw) as { code: string; at: number };
    return Date.now() - at < DAYS * 86_400_000 ? code : undefined;
  } catch {
    return undefined;
  }
}
