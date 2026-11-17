// Per-page full text of a PDF attachment without opening the reader
// (context.md §6.1, docs/decisions.md).
//
// 1. Zotero's full-text cache (.zotero-ft-cache), only if the index covers
//    every page, the "\f" piece count equals the page count, and the cache is
//    not older than the PDF.
// 2. Otherwise Zotero.PDFWorker.getFullText(itemID, null): same "\f" format,
//    all pages, no reader needed.

import { formatPages, looksLikeNoTextLayer, splitPages } from "./pagesText";

async function fromCache(attachment: Zotero.Item): Promise<string[] | null> {
  try {
    const info: any = await Zotero.Fulltext.getPages(attachment.id);
    const total = Number(info?.total) || 0;
    if (!total || Number(info?.indexedPages) !== total) return null;
    const cachePath = Zotero.Fulltext.getItemCacheFile(attachment).path;
    const pdfPath = await attachment.getFilePathAsync();
    if (!pdfPath || !(await IOUtils.exists(cachePath))) return null;
    const [c, p] = await Promise.all([
      IOUtils.stat(cachePath),
      IOUtils.stat(pdfPath),
    ]);
    if ((c.lastModified ?? 0) < (p.lastModified ?? 0)) return null;
    return splitPages(await IOUtils.readUTF8(cachePath), total);
  } catch (e) {
    Zotero.debug(`[Claude Assist] ft-cache unusable: ${e}`);
    return null;
  }
}

async function fromWorker(attachment: Zotero.Item): Promise<string[]> {
  const r: any = await Zotero.PDFWorker.getFullText(attachment.id, null, true);
  const total = Number(r?.totalPages) || 0;
  return (
    splitPages(String(r?.text ?? ""), total) ??
    String(r?.text ?? "").split("\f")
  );
}

export class NoTextLayerError extends Error {}

/** Pages of the PDF; throws NoTextLayerError for scanned PDFs. */
export async function pdfPages(
  attachment: Zotero.Item,
): Promise<{ pages: string[]; source: "cache" | "worker" }> {
  const cached = await fromCache(attachment);
  const pages = cached ?? (await fromWorker(attachment));
  if (looksLikeNoTextLayer(pages)) {
    throw new NoTextLayerError(
      "PDF에서 텍스트를 거의 추출하지 못했습니다. 텍스트 레이어가 없는 스캔 PDF는 지원하지 않습니다.",
    );
  }
  return { pages, source: cached ? "cache" : "worker" };
}

/** Full text with "=== Page N ===" markers. */
export async function pdfFullText(attachment: Zotero.Item) {
  const { pages, source } = await pdfPages(attachment);
  return { text: formatPages(pages), pageCount: pages.length, source };
}

/** The paper's PDF: best attachment if it is a PDF, else the first PDF child. */
export async function paperPdf(item: Zotero.Item): Promise<Zotero.Item | null> {
  if (item.isPDFAttachment()) return item;
  if (!item.isRegularItem()) return null;
  const best = await item.getBestAttachment();
  if (best && best.isPDFAttachment()) return best;
  for (const id of item.getAttachments()) {
    const a = Zotero.Items.get(id);
    if (a && a.isPDFAttachment()) return a;
  }
  return null;
}
