// Pure helpers over the reader's per-character page data (context.md §6.2).
// No Zotero globals: unit-tested under Node.
//
// The reader (Zotero 10.0.9, resource/reader/reader.js) stores each page's
// characters with flags spaceAfter, lineBreakAfter, paragraphBreakAfter and
// ignorable. Selection ranges carry anchorOffset/headOffset into that array.

export interface PdfChar {
  c: string;
  spaceAfter?: boolean;
  lineBreakAfter?: boolean;
  paragraphBreakAfter?: boolean;
  ignorable?: boolean;
}

export interface CharText {
  /** Page text: words joined with spaces, paragraphs separated by "\n". */
  text: string;
  /** offsets[i] = index in `text` where char i starts; offsets[n] = text.length. */
  offsets: number[];
}

/**
 * Joins characters like the reader's getTextFromChars, except that a
 * paragraph break becomes "\n" so sentence and paragraph boundaries survive.
 */
export function charsToText(chars: PdfChar[]): CharText {
  let text = "";
  const offsets: number[] = [];
  for (const ch of chars) {
    offsets.push(text.length);
    if (ch.ignorable) continue;
    text += ch.c ?? "";
    if (ch.paragraphBreakAfter) text += "\n";
    else if (ch.spaceAfter || ch.lineBreakAfter) text += " ";
  }
  offsets.push(text.length);
  return { text, offsets };
}

/** Text range [start, end) for chars [charStart, charEnd). */
export function charRangeToText(
  ct: CharText,
  charStart: number,
  charEnd: number,
): { start: number; end: number } {
  const n = ct.offsets.length - 1;
  const s = Math.max(0, Math.min(charStart, n));
  const e = Math.max(s, Math.min(charEnd, n));
  return { start: ct.offsets[s], end: ct.offsets[e] };
}

const SKIP = /[\s­\-‐‑]/u;

/**
 * Normalized form used for matching: NFKC (splits ligatures like "ﬁ"),
 * lowercase, without whitespace, soft hyphens or hyphens (so line-end
 * hyphenation and spacing differences do not matter). `map[k]` is the index
 * in the original string of normalized char k.
 */
export function compact(s: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < s.length;) {
    const cp = s.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    if (!SKIP.test(ch)) {
      for (const u of ch.normalize("NFKC").toLowerCase()) {
        if (SKIP.test(u)) continue;
        text += u;
        map.push(i);
      }
    }
    i += ch.length;
  }
  return { text, map };
}

/** Finds `needle` in `haystack` ignoring the differences listed in compact(). */
export function findText(
  haystack: string,
  needle: string,
): { start: number; end: number } | null {
  const h = compact(haystack);
  const n = compact(needle).text;
  if (!n) return null;
  const k = h.text.indexOf(n);
  if (k < 0) return null;
  const last = h.map[k + n.length - 1];
  const end = last + String.fromCodePoint(haystack.codePointAt(last)!).length;
  return { start: h.map[k], end };
}

// Abbreviations common in ML papers that end with "." but not a sentence.
const ABBREV =
  /\b(?:e\.g|i\.e|et al|etc|vs|cf|fig|figs|eq|eqs|sec|secs|tab|ref|refs|no|approx|resp|w\.r\.t|i\.i\.d|appx|thm|lem|def|prop|alg|ch)\.\s*$/i;
// An author initial ("J. Smith"); case-sensitive so "of size k." still ends a sentence.
const INITIAL = /\b[A-Z]\.\s*$/;

const SEGMENTER = new Intl.Segmenter("en", { granularity: "sentence" });

/** Sentence spans [start, end) covering `text` (whitespace stays attached). */
export function sentenceSpans(text: string): Array<[number, number]> {
  const raw: Array<[number, number]> = [];
  for (const s of SEGMENTER.segment(text))
    raw.push([s.index, s.index + s.segment.length]);
  const out: Array<[number, number]> = [];
  for (const span of raw) {
    const prev = out[out.length - 1];
    // Merge after an abbreviation unless a paragraph break separates them.
    if (prev) {
      const prevText = text.slice(prev[0], prev[1]);
      if (
        !prevText.includes("\n") &&
        (ABBREV.test(prevText) || INITIAL.test(prevText))
      ) {
        prev[1] = span[1];
        continue;
      }
    }
    out.push([span[0], span[1]]);
  }
  return out;
}

/**
 * Context around text[start, end): `n` whole sentences before plus the part
 * of the sentence before the target, and the rest of the sentence after the
 * target plus `n` sentences after (context.md §7).
 */
export function sentenceContext(
  text: string,
  start: number,
  end: number,
  n: number,
): { before: string; after: string } {
  const spans = sentenceSpans(text);
  // Sentence containing `start`; spans.length if the target starts past the
  // last sentence (e.g. on trailing whitespace).
  let first = spans.findIndex(([, e]) => e > start);
  if (first < 0) first = spans.length;
  let last = spans.findIndex(([, e]) => e >= end);
  if (last < 0) last = spans.length - 1;
  const fromIdx = Math.max(0, first - n);
  const from = fromIdx < spans.length ? spans[fromIdx][0] : start;
  const to = spans[Math.min(spans.length - 1, last + n)]?.[1] ?? text.length;
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  return {
    before: clean(text.slice(from, start)),
    after: clean(text.slice(end, to)),
  };
}
