import { jsPDF } from "jspdf";

interface BookingData {
  id: string;
  check_in: string;
  check_out: string;
  total_amount: number;
  platform_fee: number;
  checkin_code: string;
  mpesa_ref: string | null;
  company_name?: string | null;
  kra_pin?: string | null;
  room_amount?: number;
  levy_amount?: number;
  deposit_amount?: number;
  group_name?: string | null;
  is_corporate?: boolean;
}

/** Card references start with AVC-; everything else is an M-Pesa receipt. */
const payLabel = (ref: string | null) => (ref?.startsWith("AVC-") ? "Card payment ref" : "M-Pesa ref");
const payRef = (ref: string | null) => (ref ? (ref.startsWith("AVC-") ? ref.slice(4, 12).toUpperCase() : ref) : "N/A");

export function generateBookingPDF(booking: BookingData): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  // Header bar
  doc.setFillColor(31, 77, 54); // Avistay acacia green
  doc.rect(0, 0, pageW, 30, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.text("Avistay", 15, 12);
  doc.setFontSize(9);
  doc.text("avistay.com", 15, 20);
  doc.text("Booking Confirmation", pageW - 15, 18, { align: "right" });

  // Check-in code — large and prominent
  doc.setTextColor(13, 61, 32);
  doc.setFontSize(11);
  doc.text("YOUR CHECK-IN CODE", pageW / 2, 48, { align: "center" });

  doc.setFontSize(48);
  doc.setFont("helvetica", "bold");
  doc.text(booking.checkin_code, pageW / 2, 68, { align: "center" });

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 100);
  doc.text("Show this code to the property owner on arrival", pageW / 2, 76, { align: "center" });

  // Divider
  doc.setDrawColor(220, 220, 220);
  doc.line(15, 82, pageW - 15, 82);

  // Booking details
  const rows: [string, string][] = [
    ["Booking ID",   booking.id.slice(0, 8).toUpperCase()],
    ["Check-in",     booking.check_in],
    ["Check-out",    booking.check_out],
    ["Total paid",   `KES ${booking.total_amount.toLocaleString()}`],
    [payLabel(booking.mpesa_ref), payRef(booking.mpesa_ref)],
  ];

  doc.setFontSize(10);
  let y = 94;
  for (const [label, value] of rows) {
    doc.setTextColor(120, 120, 120);
    doc.text(label, 15, y);
    doc.setTextColor(20, 20, 20);
    doc.text(value, 90, y);
    y += 10;
  }

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(160, 160, 160);
  doc.text(
    "Kenya's first local-first vacation rental platform · Built by a Naivasha resident",
    pageW / 2, 270, { align: "center" }
  );

  doc.save(`avistay-booking-${booking.id.slice(0, 8)}.pdf`);
}

export function generateCorporateInvoicePDF(booking: BookingData, propertyTitle: string): void {
  const doc   = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const nights = Math.max(1,
    (new Date(booking.check_out).getTime() - new Date(booking.check_in).getTime()) / 86400000
  );
  // The booking's own price snapshot: these always add up to what was paid.
  const room    = booking.room_amount ?? 0;
  const levy    = booking.levy_amount ?? 0;
  const deposit = booking.deposit_amount ?? 0;
  const discount = Math.max(0, room + levy + booking.platform_fee + deposit - booking.total_amount);
  const invoiceNo = `AV-INV-${booking.id.slice(0, 8).toUpperCase()}`;
  const today = new Date().toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" });

  // Header
  doc.setFillColor(31, 77, 54);
  doc.rect(0, 0, pageW, 36, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18); doc.setFont("helvetica", "bold");
  doc.text("Avistay", 15, 14);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text("avistay.com  ·  Naivasha, Kenya", 15, 22);
  doc.setFontSize(14); doc.setFont("helvetica", "bold");
  doc.text("BOOKING INVOICE", pageW - 15, 20, { align: "right" });

  // Invoice meta
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.setTextColor(80, 80, 80);
  doc.text(`Invoice No:  ${invoiceNo}`, 15, 46);
  doc.text(`Invoice Date: ${today}`, 15, 53);
  doc.text(`${payLabel(booking.mpesa_ref)}:  ${payRef(booking.mpesa_ref)}`, 15, 60);

  // Bill to
  doc.setFillColor(245, 248, 245);
  doc.rect(15, 68, pageW - 30, 28, "F");
  doc.setTextColor(31, 77, 54); doc.setFontSize(8); doc.setFont("helvetica", "bold");
  doc.text("BILLED TO", 20, 76);
  doc.setTextColor(20, 20, 20); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(booking.company_name ?? "N/A", 20, 84);
  doc.setFontSize(9); doc.setTextColor(80, 80, 80);
  doc.text(`KRA PIN: ${booking.kra_pin ?? "N/A"}`, 20, 91);
  if (booking.group_name) doc.text(`Group: ${booking.group_name}`, 20, 96);

  // Table header
  const tY = 108;
  doc.setFillColor(31, 77, 54);
  doc.rect(15, tY - 5, pageW - 30, 8, "F");
  doc.setTextColor(255, 255, 255); doc.setFontSize(8); doc.setFont("helvetica", "bold");
  doc.text("Description", 18, tY);
  doc.text("Nights", 120, tY);
  doc.text("Amount (KES)", pageW - 18, tY, { align: "right" });

  // Line items
  const lines: [string, string, number][] = [
    [`Accommodation: ${propertyTitle}`, String(nights), room],
    ["Tourism levy", "", levy],
    ["Avistay service fee", "", booking.platform_fee],
    ...(deposit ? [["Refundable damage deposit", "", deposit] as [string, string, number]] : []),
    ...(discount ? [["Promo discount", "", -discount] as [string, string, number]] : []),
  ];
  doc.setTextColor(20, 20, 20); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  let ly = tY + 12;
  lines.forEach(([desc, nts, amt], i) => {
    if (i % 2 === 0) { doc.setFillColor(250, 252, 250); doc.rect(15, ly - 5, pageW - 30, 9, "F"); }
    doc.text(desc, 18, ly);
    if (nts) doc.text(nts, 120, ly);
    doc.text(`KES ${amt.toLocaleString()}`, pageW - 18, ly, { align: "right" });
    ly += 11;
  });

  // Total
  doc.setDrawColor(31, 77, 54); doc.line(15, ly, pageW - 15, ly);
  ly += 8;
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(31, 77, 54);
  doc.text("TOTAL", 18, ly);
  doc.text(`KES ${booking.total_amount.toLocaleString()}`, pageW - 18, ly, { align: "right" });

  // Footer
  doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(140, 140, 140);
  doc.text("This is a computer-generated invoice and does not require a physical signature.", pageW / 2, 260, { align: "center" });
  doc.text("Not a KRA eTIMS tax invoice. Contact hello@avistay.com for an official tax invoice.", pageW / 2, 266, { align: "center" });

  doc.save(`avistay-invoice-${invoiceNo}.pdf`);
}

interface AgentVoucherData {
  booking_id: string;
  property_title: string;
  check_in: string;
  check_out: string;
  commission_kes: number;
  status: string;
  paid_at: string | null;
}

export function generateAgentVoucherPDF(data: AgentVoucherData): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const today = new Date().toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" });

  // Header
  doc.setFillColor(31, 77, 54);
  doc.rect(0, 0, pageW, 30, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18); doc.setFont("helvetica", "bold");
  doc.text("Avistay", 15, 13);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text("Agent Commission Voucher", pageW - 15, 18, { align: "right" });

  // Booking summary box
  doc.setFillColor(245, 248, 245);
  doc.rect(15, 40, pageW - 30, 50, "F");
  doc.setTextColor(31, 77, 54); doc.setFontSize(8); doc.setFont("helvetica", "bold");
  doc.text("BOOKING DETAILS", 20, 50);

  doc.setTextColor(20, 20, 20); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(data.property_title, 20, 60);

  doc.setFontSize(9); doc.setTextColor(80, 80, 80);
  const rows: [string, string][] = [
    ["Booking ID",  data.booking_id.slice(0, 8).toUpperCase()],
    ["Check-in",    data.check_in],
    ["Check-out",   data.check_out],
    ["Status",      data.status.toUpperCase()],
  ];
  let y = 68;
  rows.forEach(([label, val]) => {
    doc.setTextColor(120, 120, 120); doc.text(label, 20, y);
    doc.setTextColor(20, 20, 20);   doc.text(val, 90, y);
    y += 8;
  });

  // Commission highlight
  doc.setFillColor(31, 77, 54);
  doc.rect(15, 104, pageW - 30, 24, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11); doc.setFont("helvetica", "normal");
  doc.text("Your Commission", 20, 116);
  doc.setFontSize(18); doc.setFont("helvetica", "bold");
  doc.text(`KES ${data.commission_kes.toLocaleString()}`, pageW - 18, 116, { align: "right" });

  if (data.paid_at) {
    doc.setFontSize(8); doc.setFont("helvetica", "normal");
    doc.text(
      `Paid on ${new Date(data.paid_at).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" })}`,
      pageW / 2, 125, { align: "center" }
    );
  }

  // Footer
  doc.setFontSize(7); doc.setFont("helvetica", "normal");
  doc.setTextColor(140, 140, 140);
  doc.text(`Generated on ${today}  ·  avistay.com`, pageW / 2, 260, { align: "center" });
  doc.text("Commission paid via M-Pesa. Contact hello@avistay.com for queries.", pageW / 2, 266, { align: "center" });

  doc.save(`avistay-agent-voucher-${data.booking_id.slice(0, 8)}.pdf`);
}
