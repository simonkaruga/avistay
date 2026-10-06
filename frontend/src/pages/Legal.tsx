import { useNavigate } from "react-router-dom";

import { ArrowLeft } from "lucide-react";
import { useProtectionWindow, useSite } from "../components/SiteNotice";

// Live values from Admin → Settings, usable inside the static text below.
const Fee = () => <>KES {useSite().serviceFee.toLocaleString()}</>;
const Levy = () => <>{useSite().levyPct}%</>;
const PayoutWindow = () => <>{useProtectionWindow()}</>;
const DepositDays = () => <>{useSite().depositDays}</>;
const CONTENT: Record<string, { title: string; body: React.ReactNode }> = {
  terms: {
    title: "Terms of Service",
    body: (
      <div className="space-y-5 text-sm text-(--text-muted) leading-relaxed">
        <p>By using Avistay you agree to the following terms. Please read them carefully.</p>

        <section className="space-y-2">
          <h2 className="font-semibold text-(--text-primary)">1. Bookings</h2>
          <p>All bookings are confirmed only after successful payment by M-Pesa or card. Card payments are processed by Paystack; Avistay never sees or stores card numbers. Paying by card adds a card fee, shown before you pay. The platform acts as a payment intermediary: the stay amount is held by Avistay and paid to the owner <PayoutWindow /> after the guest checks in, unless the guest reports a problem in that time. A refundable damage deposit, where shown at checkout, is returned to the guest <DepositDays /> after check-out unless the owner reports damage.</p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-(--text-primary)">2. Guest Conduct</h2>
          <p>Guests are expected to respect the property and follow house rules provided by the owner. If the owner reports damage with evidence and Avistay upholds the claim, the cost is paid from the guest's damage deposit.</p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-(--text-primary)">3. Platform Fees</h2>
          <p>A <Fee /> service fee applies per booking. A <Levy /> tourism levy is collected in accordance with Kenyan law. These are included in the total shown at checkout.</p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-(--text-primary)">4. Liability</h2>
          <p>Avistay is a marketplace connecting guests with property owners. Guests and owners can report problems with a booking in the app; Avistay reviews the evidence from both sides and decides how held funds are released. We are not liable for disputes between guests and owners beyond the funds we hold for that booking.</p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-(--text-primary)">5. Changes</h2>
          <p>We may update these terms at any time. Continued use of the platform constitutes acceptance of any revised terms.</p>
        </section>

        <p className="text-xs">Last updated: October 2026</p>
      </div>
    ),
  },
  privacy: {
    title: "Privacy Policy",
    body: (
      <div className="space-y-5 text-sm text-(--text-muted) leading-relaxed">
        <p>Avistay collects minimal data necessary to provide the booking service.</p>

        <section className="space-y-2">
          <h2 className="font-semibold text-(--text-primary)">Data We Collect</h2>
          <ul className="list-disc pl-4 space-y-1">
            <li>Phone number (for authentication via OTP)</li>
            <li>Booking details (dates, property, payment reference)</li>
            <li>Optional display name</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-(--text-primary)">How We Use It</h2>
          <p>Your data is used solely to process bookings, send booking confirmations, and communicate about your stay. We do not sell your data to third parties.</p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-(--text-primary)">Payments</h2>
          <p>M-Pesa payments are processed by Safaricom and card payments by Paystack. We store only the transaction reference number. Your M-Pesa PIN and card number are never seen or stored by us.</p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-(--text-primary)">Data Retention</h2>
          <p>Booking records are retained for 7 years as required by Kenyan tax law. You may request deletion of your account by contacting support.</p>
        </section>

        <p className="text-xs">Last updated: January 2025</p>
      </div>
    ),
  },
  cancellation: {
    title: "Cancellation Policy",
    body: (
      <div className="space-y-5 text-sm text-(--text-muted) leading-relaxed">
        <p>Each home has one of three cancellation policies, chosen by the owner. The policy is shown on the
          listing and again before you pay, with the exact date free cancellation ends.</p>

        <div className="space-y-3">
          {[
            { name: "Flexible", rule: "Full refund if you cancel at least 1 day before check-in." },
            { name: "Moderate", rule: "Full refund if you cancel at least 5 days before check-in." },
            { name: "Strict",   rule: "50% refund if you cancel at least 7 days before check-in." },
          ].map(r => (
            <div key={r.name} className="bg-(--bg-surface) rounded-2xl p-4">
              <p className="text-(--text-primary) font-semibold text-sm">{r.name}</p>
              <p className="text-sm mt-0.5">{r.rule} After that, the stay is non-refundable.</p>
            </div>
          ))}
        </div>

        <section className="space-y-2">
          <h2 className="font-semibold text-(--text-primary)">What is refunded</h2>
          <ul className="list-disc pl-4 space-y-1">
            <li>The refundable damage deposit is always returned in full when you cancel.</li>
            <li>The stay (nightly price and <Levy /> tourism levy) is refunded at the percentage above.</li>
            <li>The <Fee /> service fee is refunded only when you get a full refund.</li>
            <li>If you paid by card, the card fee is not refunded when you cancel. Refunds go back to the same card and usually appear within 5 to 10 working days.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-(--text-primary)">How to cancel</h2>
          <p>Open Trips, find your booking and tap Cancel booking. You'll see exactly how much comes back before you confirm. Refunds are sent to the M-Pesa number you paid from.</p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-(--text-primary)">If the owner cancels</h2>
          <p>You receive a 100% refund, including all fees and your deposit, whatever the timing.</p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-(--text-primary)">Problems during your stay</h2>
          <p>If you can't get in, or the home isn't as described, report it in the app from your check-in day.
            While we review it the owner is not paid, and we can refund you from the funds we hold.</p>
        </section>

        <p className="text-xs">Last updated: October 2026</p>
      </div>
    ),
  },
};

export default function Legal({ page }: { page: "terms" | "privacy" | "cancellation" }) {
  const navigate = useNavigate();
  const { title, body } = CONTENT[page];

  return (
    <div className="min-h-screen bg-(--bg-primary) pb-24">
      <div className="sticky top-0 z-40 flex items-center gap-3 px-4 py-4 bg-(--bg-surface) border-b border-(--border)">
        <button onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full bg-(--bg-primary) flex items-center justify-center shrink-0">
          <ArrowLeft className="w-5 h-5 text-(--text-primary)" strokeWidth={2.5} aria-hidden="true" />
        </button>
        <h1 className="font-semibold text-(--text-primary)">{title}</h1>
      </div>
      <div className="px-5 pt-5 max-w-lg mx-auto">
        {body}
      </div>
    </div>
  );
}
