// Reads text around a selection from the open reader (context.md §6.2).
//
// Depends on PRIVATE reader internals (verified in Zotero 10.0.9):
//   reader._internalReader._primaryView / _secondaryView
//   view._pdfPages[pageIndex].chars, view._ensureBasicPageData(pageIndex)
//   view._selectionRanges[i] = {anchorOffset, headOffset, collapsed, position:{pageIndex}}
// Callers must treat a null result as "no context" and carry on.
//
// pageData approach adapted from YufeiXIA/zotero-claude-code (bridge.js), MIT.

import {
  charRangeToText,
  charsToText,
  compact,
  findText,
  sentenceContext,
  type PdfChar,
} from "./chars";

type View = any;

function views(reader: any): View[] {
  const r = reader?._internalReader;
  return [r?._primaryView, r?._secondaryView].filter(Boolean);
}

async function pageChars(
  view: View,
  pageIndex: number,
): Promise<PdfChar[] | null> {
  let page = view._pdfPages?.[pageIndex];
  if (!page?.chars?.length && typeof view._ensureBasicPageData === "function") {
    await view._ensureBasicPageData(pageIndex);
    page = view._pdfPages?.[pageIndex];
  }
  return page?.chars?.length ? page.chars : null;
}

interface CharSelection {
  view: View;
  pageIndex: number;
  start: number;
  end: number;
}

/**
 * The current text selection as char offsets, one entry per page in page
 * order. In split view both panes may hold a selection; the one whose text
 * matches the popup's text wins, otherwise the first pane with a selection.
 */
function currentSelection(reader: any, selectedText: string): CharSelection[] {
  const want = compact(selectedText).text;
  let fallback: CharSelection[] = [];
  for (const view of views(reader)) {
    const ranges = (view._selectionRanges || []).filter(
      (r: any) => r && !r.collapsed && r.position,
    );
    if (!ranges.length) continue;
    const sel: CharSelection[] = ranges
      .map((r: any) => ({
        view,
        pageIndex: r.position.pageIndex,
        start: Math.min(r.anchorOffset, r.headOffset),
        end: Math.max(r.anchorOffset, r.headOffset),
      }))
      .sort((a: CharSelection, b: CharSelection) => a.pageIndex - b.pageIndex);
    const text = ranges.map((r: any) => r.text || "").join(" ");
    if (want && compact(text).text === want) return sel;
    if (!fallback.length) fallback = sel;
  }
  return fallback;
}

export interface SelectionContext {
  before: string;
  after: string;
}

/**
 * `n` sentences before and after the selected text, from the same page(s).
 * Uses the reader's selection offsets; if those are unavailable, searches
 * `selectedText` on `pageIndexHint`. Returns null when neither works.
 */
export async function selectionSentenceContext(
  reader: any,
  selectedText: string,
  pageIndexHint: number | undefined,
  n: number,
): Promise<SelectionContext | null> {
  try {
    const sel = currentSelection(reader, selectedText);
    if (sel.length) {
      const first = sel[0];
      const last = sel[sel.length - 1];
      const firstChars = await pageChars(first.view, first.pageIndex);
      const lastChars =
        last === first
          ? firstChars
          : await pageChars(last.view, last.pageIndex);
      if (firstChars && lastChars) {
        const a = charsToText(firstChars);
        const b = last === first ? a : charsToText(lastChars);
        const ra = charRangeToText(a, first.start, first.end);
        const rb = charRangeToText(b, last.start, last.end);
        return {
          before: sentenceContext(a.text, ra.start, ra.end, n).before,
          after: sentenceContext(b.text, rb.start, rb.end, n).after,
        };
      }
    }
    if (pageIndexHint === undefined) return null;
    for (const view of views(reader)) {
      const chars = await pageChars(view, pageIndexHint);
      if (!chars) continue;
      const { text } = charsToText(chars);
      const hit = findText(text, selectedText);
      if (hit) return sentenceContext(text, hit.start, hit.end, n);
    }
  } catch (e) {
    Zotero.debug(`[Claude Assist] selection context failed: ${e}`);
  }
  return null;
}
