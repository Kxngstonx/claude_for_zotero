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
