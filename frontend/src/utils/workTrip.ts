/** "I'm traveling for work" on the home search — pre-fills the company booking option at checkout. */
export const WORK_TRIP_KEY = "naivastay_work_trip";

export function isWorkTrip(): boolean {
  try { return sessionStorage.getItem(WORK_TRIP_KEY) === "1"; } catch { return false; }
}
