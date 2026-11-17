// The rendered region of an image annotation (context.md §6.4).
//
// Zotero keeps a PNG per image annotation in its cache
// (<data dir>/cache/library/<KEY>.png, Zotero.Annotations.getCacheImagePath)
// and renders missing ones with Zotero.PDFWorker.renderAttachmentAnnotations,
// which is what "Add Note from Annotations" relies on (verified on 10.0.9).

import { base64, MAX_IMAGE_BYTES, scaledSize } from "./imageEncoding";

/** PNG bytes of the annotation's region, rendering it if needed; null if unavailable. */
export async function annotationPng(
  annotation: Zotero.Item,
): Promise<Uint8Array | null> {
  const ref = { libraryID: annotation.libraryID, key: annotation.key };
  if (!(await Zotero.Annotations.hasCacheImage(annotation))) {
    try {
      await Zotero.PDFWorker.renderAttachmentAnnotations(annotation.parentID!);
    } catch (e) {
      Zotero.debug(`[Claude Assist] rendering annotation images failed: ${e}`);
    }
    if (!(await Zotero.Annotations.hasCacheImage(annotation))) return null;
  }
  return IOUtils.read(Zotero.Annotations.getCacheImagePath(ref));
}

/** Re-encodes a too-large image as a smaller JPEG using a canvas. */
async function shrink(
  png: Uint8Array,
): Promise<{ mediaType: string; data: string }> {
  const win = Zotero.getMainWindow() as any;
  const url = win.URL.createObjectURL(
    new win.Blob([png], { type: "image/png" }),
  );
  try {
    const img = new win.Image();
    img.src = url;
    await img.decode();
    const { width, height } = scaledSize(img.naturalWidth, img.naturalHeight);
    const canvas = win.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "canvas",
    );
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const dataURL: string = canvas.toDataURL("image/jpeg", 0.9);
    return {
      mediaType: "image/jpeg",
      data: dataURL.slice(dataURL.indexOf(",") + 1),
    };
  } finally {
    win.URL.revokeObjectURL(url);
  }
}

/** stream-json image source for the model. */
export async function imageForModel(
  png: Uint8Array,
): Promise<{ mediaType: string; data: string }> {
  if (png.length <= MAX_IMAGE_BYTES)
    return { mediaType: "image/png", data: base64(png) };
  return shrink(png);
}
