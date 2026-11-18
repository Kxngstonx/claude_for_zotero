// TeX math in plain text ($…$, $$…$$, \(…\), \[…\]) to MathML, for places
// that show model output outside a note (the translation popup). Gecko
// renders MathML natively, so no KaTeX fonts or CSS are needed. Pure: no
// Zotero globals (unit-tested under Node).

import katex from "katex";

export type MathSegment =
  | { type: "text"; value: string }
  | { type: "math"; value: string; display: boolean };

// $$…$$ and \[…\] (display, may span lines); \(…\) and $…$ (inline, one
// line). An inline $…$ needs a non-space right after the opening and right
// before the closing $, so "costs $5 and $10" stays text. "\$" is a dollar.
const MATH =
  /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([^\n]+?)\\\)|(?<![\\$])\$(?=\S)([^$\n]*?\S)\$(?!\$)/g;

/** Splits text into plain and math segments, in order. */
export function splitMath(text: string): MathSegment[] {
  const out: MathSegment[] = [];
  let at = 0;
  for (const m of text.matchAll(MATH)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ type: "text", value: text.slice(at, i) });
    const display = m[1] !== undefined || m[2] !== undefined;
    const tex = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim();
    out.push({ type: "math", value: tex, display });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ type: "text", value: text.slice(at) });
  return out;
}

/**
 * MathML markup for one formula (wrapped in KaTeX's span). Invalid TeX is
 * shown as its source in red instead of throwing; \href and similar
 * commands stay disabled (KaTeX's default `trust: false`).
 */
export function texToMathML(tex: string, display: boolean): string {
  return katex.renderToString(tex, {
    output: "mathml",
    displayMode: display,
    throwOnError: false,
  });
}
