// Chat view helpers (m7 UI): model names, location tags in answers, pending
// memo places. Pure: unit-tested under Node.

/** "claude-sonnet-4-6" → "Sonnet 4.6", "opus" → "Opus"; others unchanged. */
export function modelLabel(id: string): string {
  const s = id.replace(/\[.*\]$/, "").trim();
  const m =
    /^(?:claude-)?(opus|sonnet|haiku|fable)(?:-(\d+)(?:-(\d{1,2})(?!\d))?)?/i.exec(
      s,
    );
  if (!m) return s;
  const name = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  const version = m[2] ? (m[3] ? `${m[2]}.${m[3]}` : m[2]) : "";
  return version ? `${name} ${version}` : name;
}

// A bracketed location tag, not a Markdown link: [Sec 3.2, p.4], [Interpretation].
const TAG = /\s*\[([^[\]\n]{1,80})\](?!\()/g;
const PAGE =
  /\bpp?\.\s*([0-9]+|[ivxlcdm]+)\b(?:\s*[-–]\s*([0-9]+|[ivxlcdm]+)\b)?/i;
const KIND =
  /^(sec|section|eq|eqs|fig|figure|table|tab|alg|algorithm|appendix|app)\b\.?/i;
const INTERP = /^(interpretation|해석)$/i;

interface Tag {
  /** Short mark: "p.4", "p.6–7", "해석", or the tag text. */
  short: string;
  /** First cited page label, if any. */
  page: string | null;
}

function parseTag(inner: string): Tag | null {
  const t = inner.trim();
  if (INTERP.test(t)) return { short: "해석", page: null };
  const p = PAGE.exec(t);
  if (p) return { short: p[2] ? `p.${p[1]}–${p[2]}` : `p.${p[1]}`, page: p[1] };
  if (KIND.test(t)) return { short: t, page: null };
  return null;
}

export type CiteSegment =
  { text: string } | { cite: string; title: string; page: string | null };

/** Splits answer text into plain runs and location-tag marks. */
export function citeSegments(text: string): CiteSegment[] {
  const out: CiteSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    const tag = parseTag(m[1]);
    if (!tag) continue;
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ cite: tag.short, title: m[1].trim(), page: tag.page });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export interface Citation {
  label: string;
  page: string;
}

/** Pages cited in an answer, once each: numeric pages ascending, then others. */
export function citations(md: string): Citation[] {
  const list: Citation[] = [];
  for (const s of citeSegments(md)) {
    if ("cite" in s && s.page) list.push({ label: s.cite, page: s.page });
  }
  return sortCitations(list);
}

/** Dedupes cited pages by label and orders them (numeric pages first). */
export function sortCitations(list: Citation[]): Citation[] {
  const seen = new Map<string, Citation>();
  for (const c of list) if (!seen.has(c.label)) seen.set(c.label, c);
  const all = [...seen.values()];
  const num = (c: Citation) => (/^\d+$/.test(c.page) ? Number(c.page) : NaN);
  const numeric = all
    .filter((c) => !isNaN(num(c)))
    .sort((a, b) => num(a) - num(b));
  return [...numeric, ...all.filter((c) => isNaN(num(c)))];
}

export interface Place {
  page: string;
  image: boolean;
}

/** "p.4, p.5 그림, p.6" for pending memo questions (repeats collapsed). */
export function placesText(places: Place[], max = 5): string {
  const names: string[] = [];
  for (const p of places) {
    const n = `p.${p.page}${p.image ? " 그림" : ""}`;
    if (names[names.length - 1] !== n) names.push(n);
  }
  const shown = names.slice(0, max).join(", ");
  return names.length > max ? `${shown} 외 ${names.length - max}곳` : shown;
}
