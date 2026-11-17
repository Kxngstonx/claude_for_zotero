// Surrounding paragraphs of an annotation (context.md §6.2).
//
// 1. Reader page chars (private internals, see readerText.ts): the chars
//    under the annotation rects → containing paragraph ± n.
// 2. Same page, located by text matching.
// 3. Fallback: ±800 characters of the page's full text, flagged "approx".
//
// readerFor adapted from YufeiXIA/zotero-claude-code (bridge.js), MIT.

import { charRangeToText, charsToText, findText } from "./chars";
import { pageChars, views } from "./readerText";
import { pdfPages } from "./fullText";
import {
  approxContext,
  charRangeInRects,
  figureContext,
  pageParagraphs,
  paragraphContext,
} from "../memo/paragraphs";

async function waitFor<T>(fn: () => T, ms: number): Promise<T | null> {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > until) return null;
    await Zotero.Promise.delay(250);
  }
}

/**
 * The open reader for the attachment, or a newly opened background tab.
 * Tabs opened here are recorded in `opened` so the caller can close them.
 */
export async function readerFor(
  attachment: Zotero.Item,
  opened: Set<string>,
): Promise<any | null> {
  const find = () =>
    (Zotero.Reader as any)._readers.find(
      (r: any) => r.itemID === attachment.id,
    );
  let reader = find();
  if (!reader) {
    reader = await Zotero.Reader.open(attachment.id, undefined, {
      openInBackground: true,
    });
    reader = reader || (await waitFor(find, 15000));
    if (!reader) return null;
    if (reader.tabID) opened.add(reader.tabID);
  }
  if (reader._initPromise) await reader._initPromise;
  // The view object exists before its PDF is loaded; page data needs the
  // loaded document (as in zotero-claude-code's readerFor).
  const ready = await waitFor(() => {
    const v = reader._internalReader?._primaryView;
    return !!(
      v &&
      (v._iframeWindow?.PDFViewerApplication?.pdfDocument ||
        v._pdfPages?.[0]?.chars?.length)
    );
  }, 20000);
  return ready ? reader : null;
}

export function closeTabs(tabIDs: Set<string>) {
  const tabs = Zotero.getMainWindow()?.Zotero_Tabs;
  for (const id of tabIDs) {
    try {
      tabs?.close(id);
    } catch {
      // already closed
    }
  }
  tabIDs.clear();
}

/** Per-batch cache of full-text pages, by attachment id. */
export type PagesCache = Map<number, Promise<string[]>>;

export interface Surrounding {
  text: string;
  approx: boolean;
}

export async function annotationSurrounding(
  annotation: Zotero.Item,
  attachment: Zotero.Item,
  n: number,
  opened: Set<string>,
  pagesCache: PagesCache = new Map(),
): Promise<Surrounding> {
  const position = JSON.parse(annotation.annotationPosition || "{}");
  const pageIndex: number = position.pageIndex ?? 0;
  const highlight = annotation.annotationText || "";

  try {
    const reader = await readerFor(attachment, opened);
    for (const view of reader ? views(reader) : []) {
      const chars = await pageChars(view, pageIndex);
      if (!chars) continue;
      const ct = charsToText(chars);
      const range = charRangeInRects(chars as any, position.rects || []);
      const hit = range
        ? charRangeToText(ct, range.start, range.end)
        : highlight
          ? findText(ct.text, highlight)
          : null;
      if (hit) {
        return {
          text: paragraphContext(ct.text, hit.start, hit.end, n),
          approx: false,
        };
      }
    }
  } catch (e) {
    Zotero.debug(
      `[Claude Assist] reader context failed for ${annotation.key}: ${e}`,
    );
  }

  // Fallback must not abort the batch (scanned PDF, worker failure).
  const pages = await cachedPages(attachment, pagesCache);
  const page = pages[pageIndex] ?? "";
  const hit = highlight ? findText(page, highlight) : null;
  const mid = Math.floor(page.length / 2);
  return {
    text: hit
      ? approxContext(page, hit.start, hit.end, 800)
      : approxContext(page, mid, mid, 800),
    approx: true,
  };
}

async function cachedPages(
  attachment: Zotero.Item,
  pagesCache: PagesCache,
): Promise<string[]> {
  try {
    let p = pagesCache.get(attachment.id);
    if (!p) {
      p = pdfPages(attachment).then((r) => r.pages);
      pagesCache.set(attachment.id, p);
    }
    return await p;
  } catch (e) {
    Zotero.debug(
      `[Claude Assist] page text failed for ${attachment.key}: ${e}`,
    );
    return [];
  }
}

/**
 * Text around an image annotation's region: the caption and the nearest
 * paragraphs above and below (reader chars). Fallback: the start of the
 * page's text, flagged approx.
 */
export async function figureSurrounding(
  annotation: Zotero.Item,
  attachment: Zotero.Item,
  n: number,
  opened: Set<string>,
  pagesCache: PagesCache = new Map(),
): Promise<Surrounding> {
  const position = JSON.parse(annotation.annotationPosition || "{}");
  const pageIndex: number = position.pageIndex ?? 0;
  const region: number[] | undefined = position.rects?.[0];
  try {
    const reader = region ? await readerFor(attachment, opened) : null;
    for (const view of reader ? views(reader) : []) {
      const chars = await pageChars(view, pageIndex);
      if (!chars) continue;
      const text = figureContext(
        pageParagraphs(chars as any, region),
        region!,
        n,
      );
      if (text) return { text, approx: false };
    }
  } catch (e) {
    Zotero.debug(
      `[Claude Assist] figure context failed for ${annotation.key}: ${e}`,
    );
  }
  const page = (await cachedPages(attachment, pagesCache))[pageIndex] ?? "";
  return { text: approxContext(page, 0, 0, 1600), approx: true };
}
