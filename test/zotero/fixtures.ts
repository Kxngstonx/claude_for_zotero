// Shared helpers for in-Zotero tests (no tests here).
import { config } from "../../package.json";

// @ts-expect-error - Plugin instance is not typed
export const api = () => Zotero[config.addonInstance].api;

// test/fixtures/make-sentences-pdf.py output (one page, Helvetica text).
const PDF_B64 =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAzNDAgPj4Kc3RyZWFtCkJUCi9GMSAxMSBUZgoxNCBUTAo3MiA3MjAgVGQKKEZlZGVyYXRlZCBsZWFybmluZyB0cmFpbnMgYSBtb2RlbCBhY3Jvc3MgbWFueSBjbGllbnRzLiBFYWNoIGNsaWVudCBrZWVwcykgVGoKVCogKGl0cyBkYXRhIGxvY2FsLiBUaGUgc2VydmVyIGFnZ3JlZ2F0ZXMgdGhlIHVwZGF0ZXMgd2l0aCBGZWRBdmcsIGFzIGluKSBUagpUKiAoRmlnLiAyIG9mIHRoZSBwYXBlci4gV2Ugc3R1ZHkgZGF0YSB2YWx1YXRpb24gZm9yIHRoaXMgc2V0dGluZy4gT3VyKSBUagpUKiAobWV0aG9kIGFzc2lnbnMgYSBzY29yZSB0byBldmVyeSBjbGllbnQuIFNjb3JlcyBndWlkZSBjbGllbnQgc2VsZWN0aW9uLikgVGoKRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDA2MzIgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo3MDIKJSVFT0YK";

export async function waitFor<T>(
  fn: () => T,
  ms = 30000,
): Promise<NonNullable<T>> {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() > until) throw new Error("timed out waiting");
    await Zotero.Promise.delay(200);
  }
}

/** Imports the one-page fixture PDF, optionally as a child of parentItemID. */
export async function importSentencesPdf(parentItemID?: number) {
  const path = PathUtils.join(PathUtils.tempDir, "zca-sentences.pdf");
  await IOUtils.write(
    path,
    Uint8Array.from(atob(PDF_B64), (c) => c.charCodeAt(0)),
  );
  return Zotero.Attachments.importFromFile({ file: path, parentItemID });
}

// test/fixtures/make-figure-pdf.py output: paragraph, bar chart (Alpha <
// Beta < Gamma), "Figure 1:" caption at y≈420, paragraph below.
const FIGURE_PDF_B64 =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA3MzQgPj4Kc3RyZWFtCkJUIC9GMSAxMSBUZiA3MiA3MjAgVGQgKEZlZGVyYXRlZCBsZWFybmluZyB0cmFpbnMgYSBzaGFyZWQgbW9kZWwgYWNyb3NzIG1hbnkgY2xpZW50cy4pIFRqIEVUCkJUIC9GMSAxMSBUZiA3MiA3MDYgVGQgKFdlIGNvbXBhcmUgdGhyZWUgYWdncmVnYXRpb24gcnVsZXMgb24gdGhlIHNhbWUgYmVuY2htYXJrLikgVGogRVQKMCAwIDAgUkcgMSB3IDkwIDQ3MCBtIDkwIDY1MCBsIFMgOTAgNDcwIG0gNTIwIDQ3MCBsIFMKMC44NSAwLjIgMC4yIHJnIDE0MCA0NzAgODAgNjAgcmUgZgowLjIgMC40IDAuODUgcmcgMjcwIDQ3MCA4MCAxMTAgcmUgZgowLjIgMC42NSAwLjMgcmcgNDAwIDQ3MCA4MCAxNzAgcmUgZgowIDAgMCByZwpCVCAvRjEgMTAgVGYgMTYwIDQ1NSBUZCAoQWxwaGEpIFRqIEVUCkJUIC9GMSAxMCBUZiAyOTUgNDU1IFRkIChCZXRhKSBUaiBFVApCVCAvRjEgMTAgVGYgNDIwIDQ1NSBUZCAoR2FtbWEpIFRqIEVUCkJUIC9GMSAxMSBUZiA3MiA0MjAgVGQgKEZpZ3VyZSAxOiBGaW5hbCBhY2N1cmFjeSBvZiBBbHBoYSwgQmV0YSBhbmQgR2FtbWEgYWdncmVnYXRpb24uKSBUaiBFVApCVCAvRjEgMTEgVGYgNzIgMzgwIFRkIChHYW1tYSByZWFjaGVzIHRoZSBoaWdoZXN0IGFjY3VyYWN5IGluIGV2ZXJ5IHJ1biB3ZSBwZXJmb3JtZWQuKSBUaiBFVApCVCAvRjEgMTEgVGYgNzIgMzY2IFRkIChBbHBoYSBpcyB0aGUgd2Vha2VzdCBydWxlIGFuZCBCZXRhIGxpZXMgaW4gYmV0d2Vlbi4pIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAxMDI2IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKMTA5NgolJUVPRgo=";

/** Chart region of the figure fixture (bars, axes and bar labels; no caption). */
export const FIGURE_RECT = [80, 448, 530, 665];

export async function importFigurePdf(parentItemID?: number) {
  const path = PathUtils.join(PathUtils.tempDir, "zca-figure.pdf");
  await IOUtils.write(
    path,
    Uint8Array.from(atob(FIGURE_PDF_B64), (c) => c.charCodeAt(0)),
  );
  return Zotero.Attachments.importFromFile({ file: path, parentItemID });
}
