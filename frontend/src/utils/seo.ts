/**
 * useSEO — drop this call at the top of any page component.
 *
 * Sets: document.title, meta description, og:/twitter: tags, canonical link,
 * and injects JSON-LD structured data (tells Google *what* the page is).
 *
 * Google executes JavaScript so this works for search ranking.
 * Social-media link previews (WhatsApp/Facebook) fall back to index.html defaults.
 */
import { useEffect } from "react";

interface SEOMeta {
  title:        string;
  description?: string;
  image?:       string;
  url?:         string;
  type?:        "website" | "article";
  jsonLd?:      object | object[];
  noIndex?:     boolean;
}

const SITE_NAME    = "Avistay";
const DEFAULT_DESC = "Book holiday homes, cottages, villas & campsites in Naivasha, Kenya. Secure M-Pesa and card payments. Verified listings. Instant confirmation.";
const DEFAULT_IMAGE = "https://avistay.com/icons/icon-512.png";

function setMeta(attr: string, key: string, value: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", value);
}

function injectJsonLd(data: object | object[]) {
  let script = document.getElementById("page-json-ld") as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement("script");
    script.id   = "page-json-ld";
    script.type = "application/ld+json";
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(Array.isArray(data) ? { "@graph": data } : data);
}

function removeJsonLd() {
  document.getElementById("page-json-ld")?.remove();
}

export function useSEO({ title, description, image, url, type = "website", jsonLd, noIndex }: SEOMeta) {
  useEffect(() => {
    const fullTitle = `${title} | ${SITE_NAME}`;
    const desc      = description ?? DEFAULT_DESC;
    const img       = image       ?? DEFAULT_IMAGE;
    const canonical = url ? `https://avistay.com${url}` : window.location.href;

    document.title = fullTitle;

    setMeta("name",     "description",         desc);
    setMeta("name",     "robots", noIndex
      ? "noindex, nofollow"
      : "index, follow, max-snippet:-1, max-image-preview:large");
    setMeta("property", "og:title",            fullTitle);
    setMeta("property", "og:description",      desc);
    setMeta("property", "og:image",            img);
    setMeta("property", "og:url",              canonical);
    setMeta("property", "og:type",             type);
    setMeta("property", "og:site_name",        SITE_NAME);
    setMeta("name",     "twitter:card",        "summary_large_image");
    setMeta("name",     "twitter:title",       fullTitle);
    setMeta("name",     "twitter:description", desc);
    setMeta("name",     "twitter:image",       img);

    let link = document.querySelector<HTMLLinkElement>("link[rel='canonical']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = canonical;

    if (jsonLd) injectJsonLd(jsonLd);
    else        removeJsonLd();

    return () => {
      document.title = `${SITE_NAME} | Holiday Homes & Cottages in Naivasha, Kenya`;
      removeJsonLd();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, image, url, type, noIndex]);
}
