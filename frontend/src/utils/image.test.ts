import { describe, expect, it } from "vitest";
import { imgSrc } from "./image";

describe("imgSrc", () => {
  it("uses the small copy of our own photos for small slots", () => {
    expect(imgSrc("/places/hells-gate/01.jpg", 480)).toBe("/places/hells-gate/01-sm.jpg");
    expect(imgSrc("/stays/cottages.jpg", 600)).toBe("/stays/cottages-sm.jpg");
    expect(imgSrc("/stays/cottages.jpg", 1200)).toBe("/stays/cottages.jpg");
    expect(imgSrc("/stays/cottages-sm.jpg", 300)).toBe("/stays/cottages-sm.jpg");
  });
});
