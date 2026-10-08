/**
 * Real payment brand marks (public/payments/*.svg). M-Pesa, Visa, Mastercard and Apple Pay
 * come from Shopify's MIT-licensed payment_icons set; the Paystack marks from paystack.com.
 * Only list cards Paystack actually accepts in Kenya. Amex is left out until confirmed.
 */

const CARDS = [
  { src: "/payments/visa.svg", alt: "Visa" },
  { src: "/payments/mastercard.svg", alt: "Mastercard" },
  { src: "/payments/apple-pay.svg", alt: "Apple Pay" },
] as const;

/** 38×24 card-style badge, the shape every checkout uses for brand marks. */
function Badge({ src, alt, h = 24 }: { src: string; alt: string; h?: number }) {
  return <img src={src} alt={alt} width={(h * 38) / 24} height={h} className="shrink-0" style={{ height: h, width: "auto" }} />;
}

export function MpesaBadge({ h = 24 }: { h?: number }) {
  return <Badge src="/payments/mpesa.svg" alt="M-Pesa" h={h} />;
}

/** Paystack's stacked-bars mark on its own, for tight spots like a radio row. */
export function PaystackMark({ size = 20 }: { size?: number }) {
  return <img src="/payments/paystack-mark.svg" alt="Paystack" height={size} className="shrink-0" style={{ height: size, width: "auto" }} />;
}

/** Full "paystack" wordmark. */
export function PaystackLogo({ h = 16 }: { h?: number }) {
  return <img src="/payments/paystack.svg" alt="Paystack" height={h} className="shrink-0" style={{ height: h, width: "auto" }} />;
}

/** Visa · Mastercard · Apple Pay: the cards a guest can pay with through Paystack. */
export function CardBadges({ h = 20, className = "" }: { h?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {CARDS.map(c => <Badge key={c.alt} {...c} h={h} />)}
    </span>
  );
}

/** Every way to pay: M-Pesa, then Paystack with its cards. */
export function AllPaymentLogos({ h = 22, className = "" }: { h?: number; className?: string }) {
  return (
    <span className={`flex flex-wrap items-center gap-2 ${className}`}>
      <MpesaBadge h={h} />
      <span className="mx-1 h-4 w-px bg-(--border)" aria-hidden="true" />
      <PaystackLogo h={Math.round(h * 0.62)} />
      <CardBadges h={h} />
    </span>
  );
}
