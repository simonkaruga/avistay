/**
 * Get a phone photo ready for upload, the way Facebook does before sending:
 * convert iPhone HEIC, resize to ≤2048px JPEG (5–10× smaller on mobile data,
 * correct orientation) and drop EXIF — which removes the GPS location of the
 * owner's home. GIFs are left as-is so animations survive.
 */
export class UploadError extends Error {
  constructor(message: string, public retryable: boolean) { super(message); }
}

const MAX_EDGE_PX = 2048;
const LOW_RES_PX = 1024;
const HEIC_RE = /\.(heic|heif)$/i;

const isHeic = (f: File) => /image\/hei[cf]/.test(f.type) || HEIC_RE.test(f.name);

export async function prepareImage(file: File, checkResolution: boolean): Promise<{ blob: Blob; lowRes: boolean }> {
  let blob: Blob = file;
  if (isHeic(file)) {
    try {
      const heic2any = (await import("heic2any")).default;
      const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
      blob = Array.isArray(out) ? out[0] : out;
    } catch {
      throw new UploadError("This iPhone photo couldn't be converted. Try exporting it as JPEG", false);
    }
  }
  if (file.type !== "image/gif") {
    try {
      const compress = (await import("browser-image-compression")).default;
      blob = await compress(new File([blob], file.name, { type: blob.type || "image/jpeg" }), {
        maxWidthOrHeight: MAX_EDGE_PX,
        maxSizeMB: 1.5,
        initialQuality: 0.85,
        fileType: "image/jpeg",
        useWebWorker: true,
        // Our own copy (public/vendor), not the library's default CDN download.
        libURL: new URL("/vendor/browser-image-compression.js", window.location.origin).href,
        preserveExif: false,
      });
    } catch {
      throw new UploadError("This file doesn't look like a photo we can read", false);
    }
  }
  let lowRes = false;
  if (checkResolution) {
    try {
      const bmp = await createImageBitmap(blob);
      lowRes = Math.max(bmp.width, bmp.height) < LOW_RES_PX;
      bmp.close();
    } catch { /* dimension check is best-effort */ }
  }
  return { blob, lowRes };
}
