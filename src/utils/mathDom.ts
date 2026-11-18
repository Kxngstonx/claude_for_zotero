// One TeX formula as a DOM node (MathML via KaTeX, see math.ts). Shared by
// the translation popup and the chat view.

import { texToMathML } from "./math";

/**
 * The formula as MathML, imported into `doc`; on failure its source with
 * the $ / $$ fences as text.
 */
export function mathNode(doc: Document, tex: string, display: boolean): Node {
  try {
    const parser = new (doc.defaultView as any).DOMParser() as DOMParser;
    const html = texToMathML(tex, display);
    const node = parser.parseFromString(html, "text/html").body?.firstChild;
    if (!node) throw new Error("empty MathML");
    return doc.importNode(node, true);
  } catch (e) {
    Zotero.debug(`[Claude Assist] math rendering failed: ${e}`);
    const fence = display ? "$$" : "$";
    return doc.createTextNode(fence + tex + fence);
  }
}
