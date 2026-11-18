// A vector progress ring for Zotero's progress window. Zotero draws the
// progress of a line from a 16 px PNG sprite (progress_arcs.png), which is
// blurry on HiDPI screens; an SVG data URI stays sharp at any scale.
// arcSvg is pure (unit-tested); applyArc and fitWindow touch the window.

const COLOR = "#d9534f"; // close to the sprite's red

/** SVG markup: a faint full ring and a red arc from 12 o'clock, clockwise. */
export function arcSvg(percent: number): string {
  const p = Math.min(100, Math.max(0, percent));
  const r = 6;
  const c = 2 * Math.PI * r;
  const on = (c * p) / 100;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
    `<circle cx="8" cy="8" r="${r}" fill="none" stroke="${COLOR}" stroke-opacity="0.2" stroke-width="2.5"/>` +
    `<circle cx="8" cy="8" r="${r}" fill="none" stroke="${COLOR}" stroke-width="2.5" ` +
    `stroke-linecap="round" stroke-dasharray="${on.toFixed(2)} ${c.toFixed(2)}" ` +
    `transform="rotate(-90 8 8)"/></svg>`
  );
}

export function arcDataUri(percent: number): string {
  return `data:image/svg+xml,${encodeURIComponent(arcSvg(percent))}`;
}

/**
 * Replaces the sprite of a progress-window line (an ItemProgress, whose
 * private `_image` box Zotero styles in setProgress) with the vector ring.
 * Call after each setProgress; 0 and 100 keep Zotero's own icons.
 */
export function applyArc(line: any, percent: number): void {
  const img = line?._image as HTMLElement | undefined;
  if (!img || percent <= 0 || percent >= 100) return;
  img.style.backgroundImage = `url("${arcDataUri(percent)}")`;
  img.style.backgroundPosition = "center";
  img.style.backgroundSize = "16px 16px";
  // A line created without an icon type has no icon-16 class to size it.
  img.style.width = "16px";
  img.style.height = "16px";
  img.style.alignSelf = "start";
}

/** Width of the line's text (and cap of the headline), in CSS px. */
export const LINE_WIDTH = 380;

/**
 * Lays out the window for a long headline and line text, then grows the
 * window to the text.
 *
 * - Zotero's stylesheet fixes the line text at 250 px while the window
 *   widens to the whole headline (the paper title), so the text wrapped
 *   far short of the window's edge. The text gets LINE_WIDTH and the
 *   headline is capped to it (cropped with "…" by its label).
 * - The text wraps at spaces, not between Korean characters.
 * - Zotero sizes the window when lines are added, not when a line's text
 *   changes, so a text that wraps onto another line was clipped. Resizes
 *   only when the line's height changed.
 */
export function fitWindow(line: any, lastHeight: number): number {
  const text = line?._itemText as HTMLElement | undefined;
  const win = text?.ownerGlobal as any;
  if (!text || !win) return lastHeight;
  text.style.width = `${LINE_WIDTH}px`;
  text.style.wordBreak = "keep-all";
  text.style.overflowWrap = "anywhere"; // a single long word still wraps
  const headline = text.ownerDocument?.getElementById(
    "zotero-progress-text-headline",
  ) as HTMLElement | null;
  if (headline) {
    // 16 px icon + margins of the line, so both end at the same edge
    headline.style.maxWidth = `${LINE_WIDTH + 26}px`;
    headline.style.overflow = "hidden";
    for (const label of Array.from(headline.children) as HTMLElement[]) {
      label.style.minWidth = "0";
    }
  }
  const h = Math.ceil(text.getBoundingClientRect().height);
  if (h !== lastHeight) {
    win.sizeToContent();
    (Zotero.ProgressWindowSet as any).tile?.(win);
  }
  return h;
}
