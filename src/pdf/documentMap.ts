// Document map and section files for the sidebar chat (context.md §6.3,
// §10.3). Pure: unit-tested under Node.
//
// Input comes from Zotero 10's structured document text (Zotero.SDT): top-level
// blocks {type: "heading"|"paragraph"|…, anchor.pageRects[[page, x1, y1, x2, y2]],
// content[{text}]} and catalog.outline entries {title, ref:[blockIndex]} or
// {title, target:{position:{pageIndex, rect}}}, with children (verified on
// 10.0.9). Section starts come from the PDF outline; without one, from heading
// blocks; without headings, one section per page.

export interface Block {
  type: string;
  /** 0-based page index. */
  page: number;
  /** Top edge of the block (PDF coordinates, y grows upward). */
  top: number;
  text: string;
}

export interface Section {
  title: string;
  /** 1-based physical pages. */
  pageStart: number;
  pageEnd: number;
  text: string;
  file: string;
}

/** Collects the text of an SDT block (any nested `text` fields, not anchors). */
export function blockText(node: unknown): string {
  const parts: string[] = [];
  const walk = (x: unknown) => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) {
      x.forEach(walk);
      return;
    }
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if (k === "anchor") continue;
      if (k === "text" && typeof v === "string") parts.push(v);
      else walk(v);
    }
  };
  walk(node);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Normalizes an SDT top-level block. */
export function toBlock(raw: any): Block {
  const r = raw?.anchor?.pageRects?.[0] ?? [];
  return {
    type: String(raw?.type ?? "paragraph"),
    page: Number.isInteger(r[0]) ? r[0] : 0,
    top: typeof r[4] === "number" ? r[4] : 0,
    text: blockText(raw?.content ?? raw),
  };
}

interface Start {
  title: string;
  block: number;
}

/** Outline entries (all levels, document order) resolved to block indexes. */
export function outlineStarts(outline: any[], blocks: Block[]): Start[] {
  const out: Start[] = [];
  const visit = (entries: any[]) => {
    for (const e of entries ?? []) {
      const title = String(e?.title ?? "").trim();
      let block: number | null = null;
      if (Array.isArray(e?.ref) && Number.isInteger(e.ref[0])) {
        block = e.ref[0];
      } else if (e?.target?.position) {
        const page = e.target.position.pageIndex;
        const y = e.target.position.rect?.[3];
        const onPage = blocks
          .map((b, i) => ({ b, i }))
          .filter(({ b }) => b.page === page);
        const byTitle = onPage.find(
          ({ b }) => b.text.toLowerCase() === title.toLowerCase(),
        );
        const byPos = onPage.find(
          ({ b }) => typeof y !== "number" || b.top <= y + 2,
        );
        block = (byTitle ?? byPos)?.i ?? null;
      }
      if (title && block !== null && block >= 0 && block < blocks.length) {
        out.push({ title, block });
      }
      visit(e?.children);
    }
  };
  visit(outline);
  return out;
}

function slug(s: string): string {
  return (
    s
      .replace(/[^\p{L}\p{N}]+/gu, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "section"
  );
}

export function sectionFileName(
  index: number,
  title: string,
  pageStart: number,
  pageEnd: number,
): string {
  const pages =
    pageStart === pageEnd ? `p${pageStart}` : `p${pageStart}-${pageEnd}`;
  return `s${String(index).padStart(2, "0")}_${slug(title)}_${pages}.md`;
}

function makeSections(blocks: Block[], starts: Start[]): Section[] {
  const sorted = [...new Map(starts.map((s) => [s.block, s])).values()].sort(
    (a, b) => a.block - b.block,
  );
  if (sorted.length && sorted[0].block > 0) {
    sorted.unshift({ title: "Front matter", block: 0 });
  }
  return sorted.map((s, k) => {
    const end = k + 1 < sorted.length ? sorted[k + 1].block : blocks.length;
    const part = blocks.slice(s.block, end);
    const pageStart = part[0].page + 1;
    const pageEnd = part[part.length - 1].page + 1;
    return {
      title: s.title,
      pageStart,
      pageEnd,
      text: part
        .map((b) => b.text)
        .filter(Boolean)
        .join("\n\n"),
      file: sectionFileName(k + 1, s.title, pageStart, pageEnd),
    };
  });
}

/** Sections from SDT blocks and outline (§6.3: outline, then headings). */
export function buildSections(blocks: Block[], outline: any[]): Section[] {
  if (!blocks.length) return [];
  let starts = outlineStarts(outline ?? [], blocks);
  if (!starts.length) {
    starts = blocks
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => b.type === "heading" && b.text)
      .map(({ b, i }) => ({ title: b.text, block: i }));
  }
  if (!starts.length) {
    starts = blocks
      .map((b, i) => ({ b, i }))
      .filter(({ b, i }) => i === 0 || blocks[i - 1].page !== b.page)
      .map(({ b, i }) => ({ title: `Page ${b.page + 1}`, block: i }));
  }
  return makeSections(blocks, starts);
}

/** One section per page (when no structured text is available). */
export function pageSections(pages: string[]): Section[] {
  return pages.map((text, i) => ({
    title: `Page ${i + 1}`,
    pageStart: i + 1,
    pageEnd: i + 1,
    text: text.trim(),
    file: sectionFileName(i + 1, `Page ${i + 1}`, i + 1, i + 1),
  }));
}

/** "p.3" or "p.4-6" (1-based physical pages). */
export function pageRange(start: number, end: number): string {
  return start === end ? `p.${start}` : `p.${start}-${end}`;
}

/** Rough token estimate (mixed English/Korean text). */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** <document_map>: one line per section (§6.3). */
export function documentMapText(sections: Section[]): string {
  return sections
    .map(
      (s) =>
        `${s.file} | ${s.title} | ${pageRange(s.pageStart, s.pageEnd)} | ~${approxTokens(s.text)} tokens`,
    )
    .join("\n");
}
