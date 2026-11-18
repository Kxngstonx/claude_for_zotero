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

// A standalone reference-list heading: "References", "7 References",
// "VII. REFERENCES", "Bibliography", "참고문헌", ...
const REF_HEADING =
  /^\s*(?:(?:\d+|[IVXLC]+)\.?\s+)?(?:references(?: and notes)?|bibliography|literature cited|works cited|참\s*고\s*문\s*헌)\s*:?\s*$/i;

// A heading that starts what follows the reference list: "Appendix",
// "APPENDIX A: Proofs", "Supplementary Material", "부록", ...
const AFTER_REFS_HEADING =
  /^\s*(?:(?:[A-Z]|\d+|[IVXLC]+)\.?\s+)?(?:appendix|appendices|supplementary|supplemental|부\s*록)\b/i;

// An appendix section without the word: "A Detailed Setup", "A THREAT
// MODEL", "A. Proof of Theorem 1", "A.2 Asynchronous Setting". No commas, so
// a reference line such as "A. Krizhevsky, I. Sutskever, ..." is not taken
// for it, and none with a year ("A Vaswani. 2017. Attention is ...").
const APPENDIX_A_HEADING = /^\s*A(?:\.\d+)*\.?\s+[A-Z][A-Za-z][^,]*$/;

const YEAR_ONCE = /\b(?:19|20)\d{2}[a-z]?\b/;
const YEAR = /\b(?:19|20)\d{2}[a-z]?\b/g;

/** Years per 1000 characters: high on reference-list pages. */
function yearDensity(page: string): number {
  const chars = page.replace(/\s+/g, "").length;
  if (!chars) return 0;
  return ((page.match(YEAR)?.length ?? 0) * 1000) / chars;
}

// A reference entry: a year, or a "[12]" / "12." entry number.
const REF_ENTRY = /\b(?:19|20)\d{2}[a-z]?\b|^\s*\[?\d{1,3}[\].]\s/;

/**
 * The reference entries at the top of a page that is mostly something else
 * (the tail of the list before acknowledgments or an appendix). Short lines
 * such as running headers ("… ICLR 2025") are passed over and never count as
 * entries; the first long line that is not an entry ends the list. Empty if
 * the page does not start with entries.
 */
function leadingReferences(page: string): string {
  const lines = page.split("\n");
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length < 60) continue;
    if (!REF_ENTRY.test(lines[i])) break;
    last = i;
  }
  return lines.slice(0, last + 1).join("\n");
}

function endsReferences(line: string): boolean {
  return (
    line.length < 120 &&
    (AFTER_REFS_HEADING.test(line) ||
      (APPENDIX_A_HEADING.test(line) && !YEAR_ONCE.test(line)))
  );
}

/**
 * The paper's main text: every page up to the end of the reference list
 * (references included). What follows it (appendix, supplementary material,
 * checklists) is dropped.
 *
 * From the "References" heading on, the list ends at the first appendix
 * heading ("Appendix", "Supplementary Material", "A Proofs", ...), cutting
 * that page at the heading line, or else at the first page that does not
 * look like a reference list (few years per character), keeping only the
 * entries at its top. If no reference heading is found, all pages are
 * returned.
 *
 * The heading is searched from 30% of the paper on, so a table of contents
 * listing "References" is not mistaken for it.
 */
export function bodyPages(pages: string[]): string[] {
  const from = pages.length >= 4 ? Math.floor(pages.length * 0.3) : 0;
  let refPage = -1;
  let refLine = -1;
  for (let p = from; p < pages.length && refPage < 0; p++) {
    const lines = pages[p].split("\n");
    const i = lines.findIndex((l) => l.length < 60 && REF_HEADING.test(l));
    if (i >= 0) [refPage, refLine] = [p, i];
  }
  if (refPage < 0) return pages;

  for (let p = refPage; p < pages.length; p++) {
    const lines = pages[p].split("\n");
    const start = p === refPage ? refLine + 1 : 0;
    const end = lines.findIndex((l, i) => i >= start && endsReferences(l));
    if (end >= 0) {
      const head = lines.slice(0, end).join("\n");
      return [...pages.slice(0, p), ...(head.trim() ? [head] : [])];
    }
    if (p > refPage && yearDensity(pages[p]) < 2) {
      const tail = leadingReferences(pages[p]);
      return [...pages.slice(0, p), ...(tail.trim() ? [tail] : [])];
    }
  }
  return pages;
}
