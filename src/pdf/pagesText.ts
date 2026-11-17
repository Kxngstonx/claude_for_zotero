// Pure helpers for per-page full text (context.md §6.1). No Zotero globals.

/**
 * Splits form-feed separated text into pages. Zotero's worker puts "\f"
 * between pages (not after the last), so n pages give n pieces. Returns null
 * when the piece count does not match `expectedPages`.
 */
export function splitPages(
  text: string,
  expectedPages: number,
): string[] | null {
  if (!text || expectedPages <= 0) return null;
  const pages = text.split("\f");
  return pages.length === expectedPages ? pages : null;
}

/** "=== Page N ===" blocks, 1-based physical page numbers. */
export function formatPages(pages: string[]): string {
  return pages.map((p, i) => `=== Page ${i + 1} ===\n${p.trim()}`).join("\n\n");
}

/**
 * Fewer than 50 non-space characters per page on average means no usable
 * text layer (scanned PDF), which is unsupported (§6.1).
 */
export function looksLikeNoTextLayer(pages: string[]): boolean {
  if (!pages.length) return true;
  const chars = pages.reduce((n, p) => n + p.replace(/\s+/g, "").length, 0);
  return chars / pages.length < 50;
}
