// Markdown → Zotero note HTML (context.md §8.1). Pure: unit-tested under Node.
//
// Model output is untrusted. Markdown is parsed into a tree of a fixed set of
// elements; every text node and attribute is escaped when serialized, so no
// markup from the model reaches the note. Links: http(s) and zotero:// only.
//
// Note-editor formats (Zotero 10.0.9 note-editor schema):
//   inline math  <span class="math">$…$</span>
//   display math <pre class="math">$$…$$</pre>
//   tables       <table><tbody><tr><th>/<td>…
// Notes are wrapped in <div data-schema-version="9">.
//
// Approach (DOM-free tree, escaped text) follows the principle of
// YufeiXIA/zotero-claude-code markdown.js (MIT); the parser is new.

export const NOTE_SCHEMA_VERSION = 9;

type Child = HNode | string;
export interface HNode {
  tag: string;
  attrs?: Record<string, string>;
  children: Child[];
}

const VOID = new Set(["br", "hr"]);
const ALLOWED = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "ul",
  "ol",
  "li",
  "pre",
  "code",
  "strong",
  "em",
  "hr",
  "br",
  "a",
  "span",
  "table",
  "tbody",
  "tr",
  "th",
  "td",
  "div",
]);

function h(
  tag: string,
  children: Child[] = [],
  attrs?: Record<string, string>,
): HNode {
  return attrs ? { tag, attrs, children } : { tag, children };
}

export function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

export function serialize(nodes: Child[]): string {
  let out = "";
  for (const n of nodes) {
    if (typeof n === "string") {
      out += escapeText(n);
      continue;
    }
    if (!ALLOWED.has(n.tag)) throw new Error(`tag not allowed: ${n.tag}`);
    const attrs = Object.entries(n.attrs ?? {})
      .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
      .join("");
    out += VOID.has(n.tag)
      ? `<${n.tag}${attrs}/>`
      : `<${n.tag}${attrs}>${serialize(n.children)}</${n.tag}>`;
  }
  return out;
}

// ---------------------------------------------------------------- inline

const SAFE_URL = /^(https?:\/\/|zotero:\/\/)/i;

/** Parses inline Markdown into nodes. */
export function parseInline(src: string): Child[] {
  const out: Child[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push(buf);
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;

    // math \( … \) (before backslash escapes, which would eat "\(")
    if ((m = rest.match(/^\\\(([\s\S]+?)\\\)/))) {
      flush();
      out.push(h("span", [`$${m[1].trim()}$`], { class: "math" }));
      i += m[0].length;
      continue;
    }
    // backslash escape of a markdown punctuation char
    if ((m = rest.match(/^\\([\\`*_{}[\]()#+\-.!$|>~])/))) {
      buf += m[1];
      i += 2;
      continue;
    }
    // inline code
    if ((m = rest.match(/^(`+)([\s\S]+?)\1(?!`)/))) {
      flush();
      out.push(h("code", [m[2].trim()]));
      i += m[0].length;
      continue;
    }
    // inline display math $$…$$ inside a paragraph → keep as inline math
    if ((m = rest.match(/^\$\$([\s\S]+?)\$\$/))) {
      flush();
      out.push(h("span", [`$${m[1].trim()}$`], { class: "math" }));
      i += m[0].length;
      continue;
    }
    // math $…$: no space after the opening or before the closing $, and the
    // closing $ is not followed by a digit (so "$5 and $10" stays text)
    if ((m = rest.match(/^\$(?=\S)((?:\\.|[^$\\\n])+?)(?<=\S)\$(?!\d)/))) {
      flush();
      out.push(h("span", [`$${m[1]}$`], { class: "math" }));
      i += m[0].length;
      continue;
    }
    // link [text](url)
    if ((m = rest.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)/))) {
      flush();
      const kids = parseInline(m[1]);
      out.push(
        SAFE_URL.test(m[2]) ? h("a", kids, { href: m[2] }) : h("span", kids),
      );
      i += m[0].length;
      continue;
    }
    // bold **…** or __…__
    if ((m = rest.match(/^(\*\*|__)(?=\S)([\s\S]+?)(?<=\S)\1/))) {
      if (m[1] === "**" || !/\w/.test(src[i - 1] ?? "")) {
        flush();
        out.push(h("strong", parseInline(m[2])));
        i += m[0].length;
        continue;
      }
    }
    // italic *…* or _…_ (underscore only at word boundaries: snake_case stays).
    // Nested **bold** / __bold__ inside is skipped over as a unit.
    if (
      (m = rest.match(
        /^(\*|_)(?!\1)(?=\S)((?:\1\1[\s\S]+?\1\1|(?!\1)[\s\S])+?)(?<=\S)\1(?!\1)/,
      ))
    ) {
      const wordBefore = /\w/.test(src[i - 1] ?? "");
      const wordAfter = /\w/.test(src[i + m[0].length] ?? "");
      if (m[1] === "*" || (!wordBefore && !wordAfter)) {
        flush();
        out.push(h("em", parseInline(m[2])));
        i += m[0].length;
        continue;
      }
    }
    buf += src[i];
    i++;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- blocks

const RE_FENCE = /^\s*(```+|~~~+)/;
const RE_HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RE_HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const RE_QUOTE = /^\s{0,3}>\s?/;
const RE_LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/**
 * A display-math block starting at lines[i]: "$$…$$" or "\\[…\\]" on one
 * line, or spread over lines. Only a block if nothing follows the closing
 * delimiter and no blank line comes before it; otherwise null (the line is
 * then a paragraph and "$$…$$" inside it becomes inline math).
 */
function displayMath(
  lines: string[],
  i: number,
): { body: string; next: number } | null {
  const t = lines[i].trim();
  const open = t.startsWith("$$") ? "$$" : t.startsWith("\\[") ? "\\[" : null;
  if (!open) return null;
  const close = open === "$$" ? "$$" : "\\]";
  const first = t.slice(2);
  const k = first.indexOf(close);
  if (k >= 0) {
    if (first.slice(k + close.length).trim()) return null;
    return { body: first.slice(0, k), next: i + 1 };
  }
  const parts = [first];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (!l.trim()) return null;
    const kk = l.indexOf(close);
    if (kk >= 0) {
      if (l.slice(kk + close.length).trim()) return null;
      parts.push(l.slice(0, kk));
      return { body: parts.join("\n"), next: j + 1 };
    }
    parts.push(l);
  }
  return null;
}

function isTableRow(line: string): boolean {
  return line.includes("|");
}

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  // split on | not preceded by a backslash
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function startsBlock(lines: string[], i: number): boolean {
  const l = lines[i];
  return (
    RE_FENCE.test(l) ||
    RE_HEADING.test(l) ||
    RE_HR.test(l) ||
    RE_QUOTE.test(l) ||
    RE_LIST.test(l) ||
    displayMath(lines, i) !== null ||
    (isTableRow(l) && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1]))
  );
}

interface ListItem {
  indent: number;
  ordered: boolean;
  start: number;
  text: string[];
}

function buildList(
  items: ListItem[],
  from: number,
  indent: number,
): [HNode, number] {
  const ordered = items[from].ordered;
  const attrs =
    ordered && items[from].start !== 1
      ? { start: String(items[from].start) }
      : undefined;
  const list = h(ordered ? "ol" : "ul", [], attrs);
  let i = from;
  while (i < items.length && items[i].indent >= indent) {
    if (items[i].indent > indent) {
      // deeper item without a parent at this level: attach to last li
      const [sub, next] = buildList(items, i, items[i].indent);
      const last = list.children[list.children.length - 1] as HNode | undefined;
      if (last) last.children.push(sub);
      else list.children.push(h("li", [sub]));
      i = next;
      continue;
    }
    const li = h("li", inlineLines(items[i].text));
    list.children.push(li);
    i++;
    if (i < items.length && items[i].indent > indent) {
      const [sub, next] = buildList(items, i, items[i].indent);
      li.children.push(sub);
      i = next;
    }
  }
  return [list, i];
}

/** Inline content of several source lines, joined with <br>. */
function inlineLines(lines: string[]): Child[] {
  const out: Child[] = [];
  lines.forEach((l, k) => {
    if (k) out.push(h("br"));
    out.push(...parseInline(l.trim()));
  });
  return out;
}

export interface MarkdownOptions {
  /** Added to heading levels (capped at h6). The note title uses h1. */
  headingShift?: number;
}

export function parseBlocks(md: string, opts: MarkdownOptions = {}): HNode[] {
  const shift = opts.headingShift ?? 0;
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: HNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    let m: RegExpMatchArray | null;

    if ((m = line.match(RE_FENCE))) {
      const fence = m[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence))
        body.push(lines[i++]);
      i++; // closing fence (or EOF)
      out.push(h("pre", [h("code", [body.join("\n")])]));
      continue;
    }

    const dm = displayMath(lines, i);
    if (dm) {
      out.push(h("pre", [`$$${dm.body.trim()}$$`], { class: "math" }));
      i = dm.next;
      continue;
    }

    if ((m = line.match(RE_HEADING))) {
      const level = Math.min(6, m[1].length + shift);
      out.push(h(`h${level}`, parseInline(m[2])));
      i++;
      continue;
    }

    if (RE_HR.test(line)) {
      out.push(h("hr"));
      i++;
      continue;
    }

    if (RE_QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trim() && RE_QUOTE.test(lines[i])) {
        body.push(lines[i].replace(RE_QUOTE, ""));
        i++;
      }
      out.push(h("blockquote", parseBlocks(body.join("\n"), opts)));
      continue;
    }

    if (
      isTableRow(line) &&
      i + 1 < lines.length &&
      RE_TABLE_SEP.test(lines[i + 1])
    ) {
      const head = splitRow(line);
      i += 2;
      const rows: HNode[] = [
        h(
          "tr",
          head.map((c) => h("th", parseInline(c))),
        ),
      ];
      while (i < lines.length && lines[i].trim() && isTableRow(lines[i])) {
        const cells = splitRow(lines[i]);
        while (cells.length < head.length) cells.push("");
        rows.push(
          h(
            "tr",
            cells.slice(0, head.length).map((c) => h("td", parseInline(c))),
          ),
        );
        i++;
      }
      out.push(h("table", [h("tbody", rows)]));
      continue;
    }

    if (RE_LIST.test(line) && !RE_HR.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length) {
        const l = lines[i];
        const lm = RE_HR.test(l) ? null : l.match(RE_LIST);
        if (lm) {
          items.push({
            indent: lm[1].replace(/\t/g, "    ").length,
            ordered: /\d/.test(lm[2]),
            start: /\d/.test(lm[2]) ? parseInt(lm[2], 10) : 1,
            text: [lm[3]],
          });
          i++;
        } else if (
          l.trim() &&
          /^\s+/.test(l) &&
          items.length &&
          !startsBlock(lines, i)
        ) {
          items[items.length - 1].text.push(l); // continuation line
          i++;
        } else break;
      }
      let k = 0;
      while (k < items.length) {
        const [list, next] = buildList(items, k, items[k].indent);
        out.push(list);
        k = next;
      }
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      (para.length === 0 || !startsBlock(lines, i))
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(h("p", inlineLines(para)));
  }
  return out;
}

/** Markdown → HTML fragment (no root wrapper). */
export function markdownToHtml(md: string, opts: MarkdownOptions = {}): string {
  return serialize(parseBlocks(md, opts));
}

/** Wraps fragment HTML in the note root element. */
export function wrapNote(innerHtml: string): string {
  return `<div data-schema-version="${NOTE_SCHEMA_VERSION}">${innerHtml}</div>`;
}

/** A plain paragraph / heading built from text (escaped). */
export function textElement(
  tag: "p" | "h1" | "h2" | "h3",
  text: string,
): string {
  return serialize([h(tag, [text])]);
}
