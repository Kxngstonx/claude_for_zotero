// Sections of a paper for the sidebar chat (context.md §6.3, §10.3), from
// Zotero 10's structured document text (Zotero.SDT); fallback: one section
// per page from the full text.

import { pdfPages } from "./fullText";
import {
  buildSections,
  pageRange,
  pageSections,
  toBlock,
  type Section,
} from "./documentMap";

export async function paperSections(
  attachment: Zotero.Item,
): Promise<Section[]> {
  try {
    const sdt = (Zotero as any).SDT;
    const reader = sdt
      ? await sdt.getReader(attachment.id, { isPriority: true })
      : null;
    if (reader) {
      const count: number = await reader.getTopLevelBlockCount();
      const raw: any[] = count > 0 ? await reader.getBlocks(0, count - 1) : [];
      const catalog = await reader.getCatalog();
      const sections = buildSections(raw.map(toBlock), catalog?.outline ?? []);
      if (sections.length) return sections;
    }
  } catch (e) {
    Zotero.debug(`[Claude Assist] structured text unavailable: ${e}`);
  }
  return pageSections((await pdfPages(attachment)).pages);
}

/** Writes one Markdown file per section into `dir` (old .md files removed). */
export async function writeSectionFiles(
  dir: string,
  sections: Section[],
): Promise<void> {
  await IOUtils.makeDirectory(dir, { createAncestors: true });
  for (const child of await IOUtils.getChildren(dir)) {
    if (child.endsWith(".md")) await IOUtils.remove(child);
  }
  for (const s of sections) {
    const pages = pageRange(s.pageStart, s.pageEnd);
    await IOUtils.writeUTF8(
      PathUtils.join(dir, s.file),
      `# ${s.title} (${pages})\n\n${s.text}\n`,
    );
  }
}
