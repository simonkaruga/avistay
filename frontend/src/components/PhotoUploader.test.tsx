import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PhotoUploader, { photoStatus, type UploadedPhoto } from "./PhotoUploader";

// ── Fakes ─────────────────────────────────────────────────────────────────────

// Image preparation (HEIC/resize/EXIF) needs a real canvas — fake it, keeping
// the real UploadError so error handling is exercised.
const lowRes = { value: false };
vi.mock("../utils/prepareImage", async importOriginal => ({
  ...(await importOriginal<typeof import("../utils/prepareImage")>()),
  prepareImage: vi.fn(async (f: File) => ({ blob: f, lowRes: lowRes.value })),
}));

class FakeXHR {
  static all: FakeXHR[] = [];
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0; responseText = ""; timeout = 0; url = ""; body: FormData | null = null; aborted = false;
  open(_m: string, url: string) { this.url = url; }
  send(body: FormData) { this.body = body; FakeXHR.all.push(this); }
  abort() { this.aborted = true; this.onabort?.(); }
  fileName() { return (this.body?.get("file") as File | null)?.name; }
  succeed(url: string) { this.status = 200; this.responseText = JSON.stringify({ secure_url: url }); this.onload?.(); }
  fail(status: number) { this.status = status; this.onload?.(); }
}

const live = () => FakeXHR.all.filter(x => !x.aborted && x.status === 0);
const photo = (name: string, type = "image/jpeg") => new File(["x"], name, { type });

function Harness({ max = 20, onState }: { max?: number; onState: (p: UploadedPhoto[]) => void }) {
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  return <PhotoUploader value={photos} maxPhotos={max} onChange={p => { setPhotos(p); onState(p); }} />;
}

function setup(max?: number) {
  let state: UploadedPhoto[] = [];
  const utils = render(<Harness max={max} onState={p => { state = p; }} />);
  const input = utils.container.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
  const add = (...files: File[]) => act(() => { fireEvent.change(input, { target: { files } }); });
  return { ...utils, add, state: () => state };
}

beforeEach(() => {
  FakeXHR.all = [];
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  URL.createObjectURL = vi.fn((f: Blob) => `blob:${(f as File).name}`);
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    cloud_name: "staycloud", api_key: "123", timestamp: 1, signature: "sig", folder: "avistay/listings/u1",
  }), { status: 200 })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); lowRes.value = false; });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PhotoUploader", () => {
  it("uploads at most 3 at a time with signed credentials", async () => {
    const u = setup();
    await u.add(...["a", "b", "c", "d", "e"].map(n => photo(`${n}.jpg`)));
    await waitFor(() => expect(live()).toHaveLength(3));

    const first = live()[0];
    expect(first.url).toBe("https://api.cloudinary.com/v1_1/staycloud/image/upload");
    expect(first.body?.get("signature")).toBe("sig");
    expect(first.body?.get("folder")).toBe("avistay/listings/u1");
    expect(first.body?.get("upload_preset")).toBeNull();

    await act(async () => first.succeed("https://res.cloudinary.com/staycloud/image/upload/a.jpg"));
    await waitFor(() => expect(FakeXHR.all).toHaveLength(4));   // queue moved on
  });

  it("matches each URL to the right photo even if one is removed mid-upload", async () => {
    const u = setup();
    await u.add(photo("a.jpg"), photo("b.jpg"), photo("c.jpg"));
    await waitFor(() => expect(live()).toHaveLength(3));
    const xhrFor = (n: string) => FakeXHR.all.find(x => x.fileName() === n)!;

    await act(async () => { fireEvent.click(screen.getByLabelText("Remove photo 1")); });   // removes a.jpg
    expect(xhrFor("a.jpg").aborted).toBe(true);

    await act(async () => xhrFor("c.jpg").succeed("https://cdn/c.jpg"));
    await act(async () => xhrFor("b.jpg").succeed("https://cdn/b.jpg"));
    await waitFor(() => expect(u.state().every(p => p.done)).toBe(true));
    expect(u.state().map(p => [p.localUrl, p.url])).toEqual([["blob:b.jpg", "https://cdn/b.jpg"], ["blob:c.jpg", "https://cdn/c.jpg"]]);
  });

  it("retries transient failures automatically", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const u = setup();
    await u.add(photo("a.jpg"));
    await waitFor(() => expect(live()).toHaveLength(1));
    await act(async () => live()[0].fail(503));
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    await waitFor(() => expect(live()).toHaveLength(1));
    await act(async () => live()[0].succeed("https://cdn/a.jpg"));
    await waitFor(() => expect(u.state()[0]).toMatchObject({ done: true, error: false, url: "https://cdn/a.jpg" }));
  });

  it("shows a Retry button for permanent failures and blocks saving until fixed", async () => {
    const u = setup();
    await u.add(photo("a.jpg"));
    await waitFor(() => expect(live()).toHaveLength(1));
    await act(async () => live()[0].fail(400));
    await waitFor(() => expect(u.state()[0].error).toBe(true));
    expect(photoStatus(u.state()).canSave).toBe(false);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry" })); });
    await waitFor(() => expect(live()).toHaveLength(1));
    await act(async () => live()[0].succeed("https://cdn/a.jpg"));
    await waitFor(() => expect(photoStatus(u.state())).toMatchObject({ canSave: true, failed: 0 }));
  });

  it("enforces the photo limit and skips files that aren't photos", async () => {
    const u = setup(2);
    await u.add(photo("a.jpg"), photo("notes.pdf", "application/pdf"), photo("b.jpg"), photo("c.jpg"));
    expect(u.state()).toHaveLength(2);
    expect(screen.getByRole("alert").textContent).toMatch(/notes\.pdf isn't a photo.*only 2 files allowed/);
  });

  it("flags small photos as low quality", async () => {
    lowRes.value = true;
    const u = setup();
    await u.add(photo("tiny.jpg"));
    await waitFor(() => expect(live()).toHaveLength(1));
    await act(async () => live()[0].succeed("https://cdn/tiny.jpg"));
    await waitFor(() => expect(screen.getByText("Low quality")).toBeTruthy());
  });

  it("moves a photo to cover with the Cover button", async () => {
    const u = setup();
    await u.add(photo("a.jpg"), photo("b.jpg"));
    await waitFor(() => expect(live()).toHaveLength(2));
    for (const x of live()) await act(async () => x.succeed(`https://cdn/${x.fileName()}`));
    await waitFor(() => expect(u.state().every(p => p.done)).toBe(true));
    await act(async () => { fireEvent.click(screen.getByLabelText("Make photo 2 the cover")); });
    expect(u.state().map(p => p.url)).toEqual(["https://cdn/b.jpg", "https://cdn/a.jpg"]);
  });
});

describe("PhotoUploader state handling", () => {
  // Note: jsdom + act() flush effects synchronously, so this can't reproduce the
  // render/effect gap the `emitted` guard protects against in real browsers —
  // it checks simultaneous completions are all recorded.
  it("records every URL when several uploads finish together", async () => {
    const u = setup();
    await u.add(photo("a.jpg"), photo("b.jpg"), photo("c.jpg"));
    await waitFor(() => expect(live()).toHaveLength(3));
    // All three finish in the same tick — before React re-renders.
    await act(async () => { for (const x of live()) x.succeed(`https://cdn/${x.fileName()}`); });
    await waitFor(() => expect(u.state().map(p => p.url)).toEqual(["https://cdn/a.jpg", "https://cdn/b.jpg", "https://cdn/c.jpg"]));
  });

  it("adopts a list the parent resets (e.g. after sending)", async () => {
    let reset: () => void = () => {};
    function Parent() {
      const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
      reset = () => setPhotos([]);
      return <><PhotoUploader value={photos} onChange={setPhotos} /><span data-testid="n">{photos.length}</span></>;
    }
    const { container } = render(<Parent />);
    const input = container.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
    await act(() => { fireEvent.change(input, { target: { files: [photo("a.jpg")] } }); });
    await waitFor(() => expect(live()).toHaveLength(1));
    await act(async () => live()[0].succeed("https://cdn/a.jpg"));
    await act(async () => reset());
    await act(() => { fireEvent.change(input, { target: { files: [photo("b.jpg")] } }); });
    expect(screen.getByTestId("n").textContent).toBe("1");   // old photo not resurrected
  });
});
