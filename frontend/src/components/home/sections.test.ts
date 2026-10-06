import { describe, expect, it } from "vitest";
import { upcomingWeekend } from "./sections";

const on = (isoDate: string) => upcomingWeekend(new Date(`${isoDate}T10:00:00`));

describe("upcomingWeekend", () => {
  it("Monday to Friday → this Friday to Sunday", () => {
    expect(on("2026-10-05")).toMatchObject({ checkIn: "2026-10-09", checkOut: "2026-10-11" }); // Mon
    expect(on("2026-10-09")).toMatchObject({ checkIn: "2026-10-09", checkOut: "2026-10-11" }); // Fri
  });
  it("Saturday → tonight to Sunday", () => {
    expect(on("2026-10-10")).toMatchObject({ checkIn: "2026-10-10", checkOut: "2026-10-11" });
  });
  it("Sunday → next weekend", () => {
    expect(on("2026-10-11")).toMatchObject({ checkIn: "2026-10-16", checkOut: "2026-10-18" });
  });
  it("crosses month ends", () => {
    expect(on("2026-10-28")).toMatchObject({ checkIn: "2026-10-30", checkOut: "2026-11-01" });
  });
});
