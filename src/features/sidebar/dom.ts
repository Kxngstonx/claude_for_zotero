const HTML = "http://www.w3.org/1999/xhtml";

/** An HTML element (also inside XUL documents), with text and inline style. */
export function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  text?: string,
  style?: string,
): HTMLElementTagNameMap[K] {
  const e = doc.createElementNS(HTML, tag) as HTMLElementTagNameMap[K];
  if (text !== undefined) e.textContent = text;
  if (style) e.setAttribute("style", style);
  return e;
}
