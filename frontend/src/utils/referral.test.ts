import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureReferral, currentReferral } from "./referral";

describe("agent referral codes", () => {
  beforeEach(() => { localStorage.clear(); vi.useRealTimers(); });

  it("remembers a ?ref code from any link, uppercased", () => {
    captureReferral("?check_in=2026-11-01&ref=av7k2q9x");
    expect(currentReferral()).toBe("AV7K2Q9X");
  });

  it("ignores junk and keeps the last valid code", () => {
    captureReferral("?ref=AV7K2Q9X");
    captureReferral("?ref=<script>");
    expect(currentReferral()).toBe("AV7K2Q9X");
  });

  it("forgets the code after 30 days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T10:00:00Z"));
    captureReferral("?ref=AVOLD123");
    vi.setSystemTime(new Date("2026-11-05T10:00:00Z"));
    expect(currentReferral()).toBeUndefined();
  });
});
