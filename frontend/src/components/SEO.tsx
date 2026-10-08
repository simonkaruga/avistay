/**
 * Drop this component at the top of any page to control its title,
 * description, social preview image, and structured data.
 *
 * Google uses these to decide what to show in search results.
 * WhatsApp / Facebook / Twitter use og: / twitter: to generate link previews.
 */
import { Helmet } from "react-helmet-async";

const SITE      = "NaivaStay";
const BASE_URL  = "https://naivastay.com";
const DEFAULT_DESC =
  "Beautiful stays. Better experiences. Book holiday homes, cottages, villas & campsites in Naivasha, Kenya. " +
  "Secure M-Pesa and card payments. Verified listings. Instant confirmation.";
const DEFAULT_IMG = `${BASE_URL}/og-image.png`;

interface Props {
  title?:       string;   // page-specific title (site name is appended automatically)
  description?: string;
  image?:       string;   // absolute URL
  url?:         string;   // path, e.g. "/property/abc123"
  type?:        "website" | "article";
  noIndex?:     boolean;  // set true on admin / owner pages. Keep them off Google
  jsonLd?:      object | object[];
}

export default function SEO({
  title, description, image, url, type = "website", noIndex, jsonLd,
}: Props) {
  const fullTitle  = title ? `${title} | ${SITE}` : `${SITE}. Holiday Homes & Cottages in Naivasha, Kenya`;
  const desc       = description ?? DEFAULT_DESC;
  const img        = image       ?? DEFAULT_IMG;
  const canonical  = url ? `${BASE_URL}${url}` : BASE_URL;
  const schemas    = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={desc} />
      {noIndex
        ? <meta name="robots" content="noindex, nofollow" />
        : <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large" />
      }
      <link rel="canonical" href={canonical} />

      {/* Open Graph — Facebook, WhatsApp, LinkedIn */}
      <meta property="og:title"       content={fullTitle} />
      <meta property="og:description" content={desc} />
      <meta property="og:image"       content={img} />
      <meta property="og:url"         content={canonical} />
      <meta property="og:type"        content={type} />
      <meta property="og:site_name"   content={SITE} />
      <meta property="og:locale"      content="en_KE" />

      {/* Twitter / X */}
      <meta name="twitter:card"        content="summary_large_image" />
      <meta name="twitter:title"       content={fullTitle} />
      <meta name="twitter:description" content={desc} />
      <meta name="twitter:image"       content={img} />

      {/* JSON-LD structured data — tells Google exactly what kind of content this is */}
      {schemas.map((schema, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(schema)}
        </script>
      ))}
    </Helmet>
  );
}
