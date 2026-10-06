import { describe, expect, it, vi } from "vitest";

const texts: string[] = [];
vi.mock("jspdf", () => {
  // Records every line written; the drawing calls are no-ops.
  class FakePDF {
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    text(t: string | string[]) { texts.push(Array.isArray(t) ? t.join(" ") : t); return this; }
    save() { return this; }
  }
  const handler: ProxyHandler<FakePDF> = {
    get: (target, prop) => (prop in target ? (target as never)[prop] : () => proxy),
  };
  let proxy: FakePDF;
  function Factory() { proxy = new Proxy(new FakePDF(), handler); return proxy; }
  return { default: Factory, jsPDF: Factory };
});

import { generateCorporateInvoicePDF } from "./pdf";

describe("company invoice PDF", () => {
  it("lists the booking's real amounts and they add up to the total", () => {
    generateCorporateInvoicePDF({
      id: "abcdef12-0000-0000-0000-000000000000", check_in: "2026-11-05", check_out: "2026-11-07",
      total_amount: 15_000, platform_fee: 300, room_amount: 10_000, levy_amount: 200, deposit_amount: 5_000,
      checkin_code: "1234", mpesa_ref: "AVC-9f8e7d6c-1111", company_name: "Acme Ltd", kra_pin: "P051234567A",
    }, "Lake Cottage");

    const all = texts.join("\n");
    expect(all).toContain("KES 10,000");          // room
    expect(all).toContain("KES 200");             // levy
    expect(all).toContain("KES 5,000");           // deposit
    expect(all).toContain("KES -500");            // promo discount that makes it add up
    expect(all).toContain("KES 15,000");          // total
    expect(all).toContain("Card payment ref");    // not "M-Pesa" for a card booking
    expect(all).not.toContain("TAX INVOICE");
    expect(all).not.toContain("P.O. Box");
  });
});
