// Paragraph context around an annotation (context.md §6.2). Pure.

import type { PdfChar } from "../pdf/chars.ts";

type Rect = number[];

function center(r: Rect): [number, number] {
  return [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
}

function inRect([x, y]: [number, number], r: Rect): boolean {
  return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
}

/**
 * Char range [start, end) of a highlight given its position rects, as the
 * reader does (getRangeByHighlight): from the first char whose center lies
 * in the first rect to the last char whose center lies in the last rect.
 */
export function charRangeInRects(
  chars: Array<PdfChar & { rect?: Rect }>,
  rects: Rect[],
): { start: number; end: number } | null {
  if (!chars.length || !rects?.length) return null;
  const first = rects[0];
  const last = rects[rects.length - 1];
  const start = chars.findIndex((c) => c.rect && inRect(center(c.rect), first));
  let end = -1;
  for (let i = chars.length - 1; i >= 0; i--) {
    const r = chars[i].rect;
    if (r && inRect(center(r), last)) {
      end = i + 1;
      break;
    }
  }
  return start >= 0 && end > start ? { start, end } : null;
}

/**
 * The paragraph(s) containing text[start, end) plus `n` paragraphs before
 * and after. Paragraphs are separated by "\n" (charsToText).
 */
export function paragraphContext(
  text: string,
  start: number,
  end: number,
  n: number,
): string {
  const spans: Array<[number, number]> = [];
  let s = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\n") {
      if (text.slice(s, i).trim()) spans.push([s, i]);
      s = i + 1;
    }
  }
  if (!spans.length) return "";
  let first = spans.findIndex(([, e]) => e > start);
  if (first < 0) first = spans.length - 1;
  let last = spans.findIndex(([, e]) => e >= end);
  if (last < 0) last = spans.length - 1;
  const from = Math.max(0, first - n);
  const to = Math.min(spans.length - 1, Math.max(last, first) + n);
  return spans
    .slice(from, to + 1)
    .map(([a, b]) => text.slice(a, b).replace(/\s+/g, " ").trim())
    .join("\n\n");
}

/** Fallback (§6.2): `radius` characters on each side of the target. */
export function approxContext(
  text: string,
  start: number,
  end: number,
  radius = 800,
): string {
  const a = Math.max(0, start - radius);
  const b = Math.min(text.length, end + radius);
  return `${a > 0 ? "…" : ""}${text.slice(a, b).trim()}${b < text.length ? "…" : ""}`;
}

interface Para {
  text: string;
  /** Bounding box [x1, y1, x2, y2] in PDF coordinates (y grows upward). */
  box: Rect;
}

/**
 * Paragraphs of a page with their bounding boxes (split at
 * paragraphBreakAfter). Chars whose center lies in `exclude` (a figure
 * region) are left out, so a paragraph that runs from inside the figure
 * (axis/bar labels) into its caption keeps only the caption part.
 */
export function pageParagraphs(
  chars: Array<PdfChar & { rect?: Rect }>,
  exclude?: Rect,
): Para[] {
  const out: Para[] = [];
  let text = "";
  let box: Rect | null = null;
  const flush = () => {
    if (text.trim() && box)
      out.push({ text: text.replace(/\s+/g, " ").trim(), box });
    text = "";
    box = null;
  };
  for (const c of chars) {
    const skip = !!(exclude && c.rect && inRect(center(c.rect), exclude));
    if (!c.ignorable && !skip) {
      text += c.c ?? "";
      if (c.spaceAfter || c.lineBreakAfter) text += " ";
      if (c.rect) {
        box = box
          ? [
              Math.min(box[0], c.rect[0]),
              Math.min(box[1], c.rect[1]),
              Math.max(box[2], c.rect[2]),
              Math.max(box[3], c.rect[3]),
            ]
          : [...c.rect];
      }
    }
    if (c.paragraphBreakAfter) flush();
  }
  flush();
  return out;
}

const CAPTION = /^(fig(ure)?\.?|table|tab\.)\s*\d+/i;
const CAPTION_GAP = 60; // points

/**
 * Text around a figure region (image annotation, §9.2 step 4): the `n`
 * nearest paragraphs above and below that overlap it horizontally and lie
 * outside it, plus a nearby "Figure/Table N" caption. Paper order. Null if
 * nothing qualifies.
 */
export function figureContext(
  paras: Para[],
  region: Rect,
  n: number,
): string | null {
  const [rx1, ry1, rx2, ry2] = region;
  const overlapsX = (b: Rect) => Math.min(b[2], rx2) - Math.max(b[0], rx1) > 0;
  const inside = (b: Rect) => {
    const cx = (b[0] + b[2]) / 2;
    const cy = (b[1] + b[3]) / 2;
    return cx >= rx1 && cx <= rx2 && cy >= ry1 && cy <= ry2;
  };
  const below: Array<{ i: number; gap: number }> = [];
  const above: Array<{ i: number; gap: number }> = [];
  paras.forEach((p, i) => {
    if (!overlapsX(p.box) || inside(p.box)) return;
    if (p.box[3] <= ry1 + 1) below.push({ i, gap: ry1 - p.box[3] });
    else if (p.box[1] >= ry2 - 1) above.push({ i, gap: p.box[1] - ry2 });
  });
  const pick = new Set<number>();
  for (const side of [below, above]) {
    side.sort((a, b) => a.gap - b.gap);
    side.slice(0, Math.max(0, n)).forEach((x) => pick.add(x.i));
    for (const x of side) {
      if (x.gap <= CAPTION_GAP && CAPTION.test(paras[x.i].text)) pick.add(x.i);
    }
  }
  if (!pick.size) return null;
  return [...pick]
    .sort((a, b) => a - b)
    .map((i) => paras[i].text)
    .join("\n\n");
}
