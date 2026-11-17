// Note HTML → plain text for prompts (context.md §9.3: context note and
// previous Q&A as Markdown-like text). Uses the main window's DOMParser.
// Math keeps its $…$ / $$…$$ delimiters; <hr> becomes a "---" line.

const BLOCK = new Set([
  "p",
  "div",
  "blockquote",
  "pre",
  "ul",
  "ol",
  "table",
  "tbody",
]);

function walk(node: Node): string {
  if (node.nodeType === 3) return node.nodeValue ?? "";
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const tag = el.localName;
  const inner = () =>
    Array.from(el.childNodes)
      .map((c) => walk(c as Node))
      .join("");
  switch (tag) {
    case "br":
      return "\n";
    case "hr":
      return "\n---\n";
    case "img":
      return "[그림]";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return `\n${"#".repeat(Number(tag[1]))} ${inner().trim()}\n`;
    case "li":
      return `\n- ${inner().trim()}`;
    case "tr":
      return `\n| ${Array.from(el.children)
        .map((c) => walk(c).trim())
        .join(" | ")} |`;
    default:
      return BLOCK.has(tag) ? `\n${inner()}\n` : inner();
  }
}

export function noteHtmlToText(html: string): string {
  const Parser = Zotero.getMainWindow().DOMParser;
  const doc = new Parser().parseFromString(html, "text/html");
  return walk(doc.body)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
