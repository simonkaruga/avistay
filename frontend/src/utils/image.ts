/**
 * Returns a mobile-optimised image URL.
 * Cloudinary: inserts c_fill,w_N,q_auto transform.
 * Unsplash:   replaces w= and q= params.
 * Others:     returns as-is.
 */
export function imgSrc(url: string | undefined, displayWidth: number): string {
  if (!url) return "";

  // Our own Naivasha photos (public/places, public/stays) come in two sizes.
  if (/^\/(places|stays)\/.+(?<!-sm)\.jpg$/.test(url) && displayWidth <= 700) {
    return url.replace(/\.jpg$/, "-sm.jpg");
  }

  if (url.includes("res.cloudinary.com")) {
    return url.replace("/upload/", `/upload/c_fill,w_${displayWidth},q_auto:good,f_auto/`);
  }

  if (url.includes("unsplash.com")) {
    try {
      const u = new URL(url);
      u.searchParams.set("w",    String(displayWidth));
      u.searchParams.set("q",    displayWidth <= 500 ? "70" : "80");
      u.searchParams.set("fit",  "crop");
      u.searchParams.set("auto", "format");
      return u.toString();
    } catch {
      return url;
    }
  }

  return url;
}
